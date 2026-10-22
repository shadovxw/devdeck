package supervisor

import "time"

// State is where one service is in its life.
type State string

// The states of one service.
const (
	StateWaiting    State = "waiting"    // waiting for the services it comes after
	StateBuilding   State = "building"   // compiling (Go services)
	StateStarting   State = "starting"   // running, not ready yet
	StateReady      State = "ready"      // running and answering
	StateRestarting State = "restarting" // crashed; waiting to try again
	StateFailed     State = "failed"     // never became ready, or gave up restarting
	StateBlocked    State = "blocked"    // a service it waits for failed
	StateStopping   State = "stopping"
	StateStopped    State = "stopped"
)

// RunState is where a whole stack is.
type RunState string

// The states of a stack.
const (
	RunStarting RunState = "starting" // some service is not ready yet
	RunRunning  RunState = "running"  // every service is ready
	RunDegraded RunState = "degraded" // some service failed or is restarting
	RunStopping RunState = "stopping"
	RunStopped  RunState = "stopped"
)

// ServiceStatus is one service as the UI sees it.
type ServiceStatus struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	State State  `json:"state"`
	Port  int    `json:"port,omitempty"`
	// Restarts counts the times it was started again after the first start.
	Restarts  int        `json:"restarts"`
	StartedAt *time.Time `json:"started_at,omitempty"`
	ReadyAt   *time.Time `json:"ready_at,omitempty"`
	// LastError says in plain words why it is failed, blocked or restarting.
	LastError string `json:"last_error,omitempty"`
	ExitCode  *int   `json:"exit_code,omitempty"`
	// Ports are the host ports a compose file's containers publish (Port is for a
	// service devdeck runs itself).
	Ports []int `json:"ports,omitempty"`
	// Optional is set for a compose file whose failure doesn't hold anything back.
	Optional bool `json:"optional,omitempty"`
}

// RunStatus is a stack that devdeck started.
type RunStatus struct {
	Workspace string          `json:"workspace"`
	Stack     string          `json:"stack"`
	State     RunState        `json:"state"`
	StartedAt time.Time       `json:"started_at"`
	Services  []ServiceStatus `json:"services"`
}
