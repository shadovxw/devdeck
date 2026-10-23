//go:build desktop

package desktop

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/shadovxw/devdeck/internal/config"
	"github.com/shadovxw/devdeck/internal/server"
)

// instanceID names the lock that keeps one devdeck window per user session.
const instanceID = "com.shadovxw.devdeck"

// Run starts devdeck and shows it in its own window, until the window is closed. When a
// devdeck server already answers on the address (devdeck serve is running), the window
// shows that one and leaves it running when it closes.
func Run(ctx context.Context, cfg config.Config, version string) error {
	// There is no terminal behind the window: the log goes to a file.
	logPath := filepath.Join(cfg.DataDir, "app.log")
	_ = os.MkdirAll(cfg.DataDir, 0o700)
	trimLog(logPath, 5<<20)
	if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600); err == nil { // #nosec G304 -- devdeck's own data folder
		defer func() { _ = f.Close() }()
		log.Logger = zerolog.New(f).With().Timestamp().Logger()
	}
	server.SetLogLevel(cfg)

	var srv *server.Server
	var closeOnce sync.Once
	closeServer := func() {
		closeOnce.Do(func() {
			if srv != nil {
				if err := srv.Close(); err != nil {
					log.Warn().Err(err).Msg("closing devdeck")
				}
			}
		})
	}
	if isDevdeck(cfg.Addr) {
		log.Info().Str("addr", cfg.Addr).Msg("a devdeck server is already running: the window uses it")
	} else {
		var err error
		if srv, err = server.New(ctx, cfg, version); err != nil {
			return err
		}
		if err := srv.Start(version); err != nil {
			_ = srv.Close()
			if err == server.ErrAddrInUse {
				return fmt.Errorf("something else is using %s: stop it, or set DEVDECK_ADDR to another address", cfg.Addr)
			}
			return err
		}
	}

	size := LoadSize(cfg.DataDir)
	var wctx context.Context
	err := wails.Run(&options.App{
		Title:     "devdeck",
		Width:     size.Width,
		Height:    size.Height,
		MinWidth:  MinWidth,
		MinHeight: MinHeight,
		// The window opens the server's own address, so the app behaves exactly as in a browser.
		AssetServer:      &assetserver.Options{Handler: loaderHandler(serverURL(cfg.Addr))},
		BackgroundColour: &options.RGBA{R: 18, G: 23, B: 27, A: 1},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: instanceID,
			// A second click on the icon brings the window that is already open forward.
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				if wctx == nil {
					return
				}
				runtime.WindowUnminimise(wctx)
				runtime.Show(wctx)
			},
		},
		OnStartup: func(c context.Context) { wctx = c },
		OnBeforeClose: func(c context.Context) bool {
			w, h := runtime.WindowGetSize(c)
			SaveSize(cfg.DataDir, Size{Width: w, Height: h})
			return false // close
		},
		OnShutdown: func(context.Context) { closeServer() },
	})
	closeServer()
	return err
}
