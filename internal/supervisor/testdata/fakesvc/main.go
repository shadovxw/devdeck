// Command fakesvc is a stand-in service for the supervisor's tests. It can
// listen, print, crash, exit and hang on command, so the tests need no real stack.
package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"
)

func main() {
	httpAddr := flag.String("http", "", "serve /health on this address")
	tcpAddr := flag.String("tcp", "", "accept connections on this address")
	readyAfter := flag.Duration("ready-after", 0, "wait this long before listening or printing the ready line")
	say := flag.String("say", "", "print this line at start")
	readyLine := flag.String("ready-line", "", "print this line once ready")
	crashAfter := flag.Duration("crash-after", 0, "exit with code 3 after this long")
	exitAfter := flag.Duration("exit-after", 0, "exit with -exit-code after this long")
	exitCode := flag.Int("exit-code", 0, "code for -exit-after")
	printEnv := flag.String("print-env", "", "print the value of this environment variable")
	flag.Parse()

	if *say != "" {
		fmt.Println(*say)
	}
	if *printEnv != "" {
		fmt.Printf("ENV %s=%s\n", *printEnv, os.Getenv(*printEnv))
	}
	if *crashAfter > 0 {
		go func() { time.Sleep(*crashAfter); fmt.Fprintln(os.Stderr, "boom"); os.Exit(3) }()
	}
	if *exitAfter > 0 {
		go func() { time.Sleep(*exitAfter); os.Exit(*exitCode) }()
	}

	time.Sleep(*readyAfter)
	if *readyLine != "" {
		fmt.Println(*readyLine)
	}
	if *tcpAddr != "" {
		l, err := net.Listen("tcp", *tcpAddr)
		if err != nil {
			fmt.Fprintln(os.Stderr, "listen:", err)
			os.Exit(2)
		}
		go func() {
			for {
				c, err := l.Accept()
				if err != nil {
					return
				}
				_ = c.Close()
			}
		}()
	}
	if *httpAddr != "" {
		mux := http.NewServeMux()
		mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) })
		l, err := net.Listen("tcp", *httpAddr)
		if err != nil {
			fmt.Fprintln(os.Stderr, "listen:", err)
			os.Exit(2)
		}
		srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
		go func() {
			if err := srv.Serve(l); err != nil {
				fmt.Fprintln(os.Stderr, "serve:", err)
				os.Exit(2)
			}
		}()
	}
	time.Sleep(24 * time.Hour) // run until killed
}
