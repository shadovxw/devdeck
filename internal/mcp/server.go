// Package mcp is devdeck's Claude Code connector: `devdeck mcp` speaks the Model
// Context Protocol over stdio and answers from the running devdeck's API. It is
// read-only, and the server holds it to that (internal/api/connector.go).
//
// Only the part of the protocol that tools need is implemented: initialize, ping,
// tools/list and tools/call, as newline-delimited JSON-RPC 2.0.
package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
)

// supported are the protocol versions the server can speak, newest first.
var supported = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

// JSON-RPC error codes.
const (
	codeParse          = -32700
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
)

// Tool is one thing Claude can ask for.
type Tool struct {
	Name        string
	Description string
	// Schema is the JSON Schema of the arguments (an object).
	Schema map[string]any
	// Call returns the text Claude reads. An error is reported to Claude as the
	// tool's own failure, in plain words, so it can tell the person.
	Call func(ctx context.Context, args json.RawMessage) (string, error)
}

// Resource is a document Claude can read by its address, without asking a tool.
type Resource struct {
	URI         string
	Name        string
	Description string
	MIME        string
	Read        func() (string, error)
}

// Prompt is a named starting point Claude Code offers the person (a slash command in
// its menu): it turns a few arguments into the message Claude then works from.
type Prompt struct {
	Name        string
	Description string
	Arguments   []PromptArg
	Build       func(args map[string]string) (string, error)
}

// PromptArg is one argument of a prompt.
type PromptArg struct {
	Name        string
	Description string
	Required    bool
}

// toolKey carries the name of the tool being called, so the request it makes can say so
// for the audit list.
type toolKey struct{}

// Server answers MCP requests with its tools, resources and prompts.
type Server struct {
	Name         string
	Version      string
	Instructions string
	Tools        []Tool
	Resources    []Resource
	Prompts      []Prompt

	mu  sync.Mutex // one writer at a time
	out io.Writer
}

type request struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// Serve reads requests from in until it ends or ctx is done, and writes the answers
// to out, one JSON object per line. Nothing else may be written to out.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	s.out = out
	dec := json.NewDecoder(in)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			var syn *json.SyntaxError
			if errors.As(err, &syn) {
				// The stream can't be trusted past a syntax error.
				_ = s.send(response{ID: json.RawMessage("null"), Error: &rpcError{codeParse, "parse error"}})
			}
			return err
		}
		var req request
		if err := json.Unmarshal(raw, &req); err != nil {
			if err := s.send(response{ID: json.RawMessage("null"), Error: &rpcError{codeParse, "parse error"}}); err != nil {
				return err
			}
			continue
		}
		if resp, ok := s.handle(ctx, req); ok {
			if err := s.send(resp); err != nil {
				return err
			}
		}
	}
}

func (s *Server) send(r response) error {
	r.JSONRPC = "2.0"
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err = s.out.Write(append(b, '\n'))
	return err
}

// handle answers one request. ok is false for a notification, which gets no answer.
func (s *Server) handle(ctx context.Context, req request) (resp response, ok bool) {
	if len(req.ID) == 0 {
		return response{}, false
	}
	resp.ID = req.ID
	switch req.Method {
	case "initialize":
		resp.Result = s.initialize(req.Params)
	case "ping":
		resp.Result = struct{}{}
	case "tools/list":
		resp.Result = map[string]any{"tools": s.list()}
	case "resources/list":
		resp.Result = map[string]any{"resources": s.listResources()}
	case "resources/templates/list":
		resp.Result = map[string]any{"resourceTemplates": []any{}}
	case "resources/read":
		result, err := s.read(req.Params)
		if err != nil {
			resp.Error = &rpcError{codeInvalidParams, err.Error()}
		} else {
			resp.Result = result
		}
	case "prompts/list":
		resp.Result = map[string]any{"prompts": s.listPrompts()}
	case "prompts/get":
		result, err := s.prompt(req.Params)
		if err != nil {
			resp.Error = &rpcError{codeInvalidParams, err.Error()}
		} else {
			resp.Result = result
		}
	case "tools/call":
		result, err := s.call(ctx, req.Params)
		if err != nil {
			resp.Error = &rpcError{codeInvalidParams, err.Error()}
		} else {
			resp.Result = result
		}
	default:
		resp.Error = &rpcError{codeMethodNotFound, "method not found: " + req.Method}
	}
	return resp, true
}

func (s *Server) initialize(params json.RawMessage) any {
	var p struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(params, &p)
	version := supported[0]
	for _, v := range supported {
		if v == p.ProtocolVersion {
			version = v
		}
	}
	caps := map[string]any{"tools": map[string]any{}}
	if len(s.Resources) > 0 {
		caps["resources"] = map[string]any{}
	}
	if len(s.Prompts) > 0 {
		caps["prompts"] = map[string]any{}
	}
	return map[string]any{
		"protocolVersion": version,
		"capabilities":    caps,
		"serverInfo":      map[string]any{"name": s.Name, "version": s.Version},
		"instructions":    s.Instructions,
	}
}

func (s *Server) list() []map[string]any {
	out := make([]map[string]any, 0, len(s.Tools))
	for _, t := range s.Tools {
		out = append(out, map[string]any{
			"name":        t.Name,
			"description": t.Description,
			"inputSchema": t.Schema,
			"annotations": map[string]any{"readOnlyHint": true, "openWorldHint": false},
		})
	}
	return out
}

func (s *Server) call(ctx context.Context, params json.RawMessage) (any, error) {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, errors.New("tools/call needs a name and arguments")
	}
	for _, t := range s.Tools {
		if t.Name != p.Name {
			continue
		}
		text, err := t.Call(context.WithValue(ctx, toolKey{}, t.Name), p.Arguments)
		if err != nil {
			return toolResult(err.Error(), true), nil
		}
		return toolResult(text, false), nil
	}
	return nil, errors.New("no such tool: " + p.Name)
}

func toolResult(text string, isError bool) map[string]any {
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": text}},
		"isError": isError,
	}
}

func (s *Server) listResources() []map[string]any {
	out := make([]map[string]any, 0, len(s.Resources))
	for _, r := range s.Resources {
		out = append(out, map[string]any{"uri": r.URI, "name": r.Name, "description": r.Description, "mimeType": r.MIME})
	}
	return out
}

func (s *Server) read(params json.RawMessage) (any, error) {
	var p struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(params, &p); err != nil || p.URI == "" {
		return nil, errors.New("resources/read needs a uri")
	}
	for _, r := range s.Resources {
		if r.URI != p.URI {
			continue
		}
		text, err := r.Read()
		if err != nil {
			return nil, err
		}
		return map[string]any{"contents": []map[string]any{{"uri": r.URI, "mimeType": r.MIME, "text": text}}}, nil
	}
	return nil, errors.New("no such resource: " + p.URI)
}

func (s *Server) listPrompts() []map[string]any {
	out := make([]map[string]any, 0, len(s.Prompts))
	for _, p := range s.Prompts {
		args := make([]map[string]any, 0, len(p.Arguments))
		for _, a := range p.Arguments {
			args = append(args, map[string]any{"name": a.Name, "description": a.Description, "required": a.Required})
		}
		out = append(out, map[string]any{"name": p.Name, "description": p.Description, "arguments": args})
	}
	return out
}

func (s *Server) prompt(params json.RawMessage) (any, error) {
	var p struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil || p.Name == "" {
		return nil, errors.New("prompts/get needs a name")
	}
	for _, pr := range s.Prompts {
		if pr.Name != p.Name {
			continue
		}
		for _, a := range pr.Arguments {
			if a.Required && p.Arguments[a.Name] == "" {
				return nil, fmt.Errorf("%s is needed", a.Name)
			}
		}
		text, err := pr.Build(p.Arguments)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"description": pr.Description,
			"messages":    []map[string]any{{"role": "user", "content": map[string]any{"type": "text", "text": text}}},
		}, nil
	}
	return nil, errors.New("no such prompt: " + p.Name)
}
