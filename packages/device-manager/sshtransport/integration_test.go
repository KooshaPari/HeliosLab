//go:build integration

// Live SSH round trip against a real server.
//
// This is the only test that exercises host key verification, authentication,
// and command execution against something other than a fake. It is behind the
// `integration` build tag because it needs a reachable host, real credentials,
// and a known_hosts entry, none of which exist in CI.
//
// Run with:
//
//	go test -tags integration -v -run TestRealSSHRoundTrip ./sshtransport/
//
// Override the target with HELIOS_SSH_HOST / HELIOS_SSH_USER / HELIOS_SSH_KEY.
package sshtransport

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	devices "github.com/helioslab/device-manager"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func TestRealSSHRoundTrip(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skipf("no home directory: %v", err)
	}

	host := envOr("HELIOS_SSH_HOST", "kooshas-laptop")
	user := envOr("HELIOS_SSH_USER", "kooshapari")
	keyPath := envOr("HELIOS_SSH_KEY", filepath.Join(home, ".ssh", "id_ed25519"))
	knownHosts := filepath.Join(home, ".ssh", "known_hosts")

	if _, err := os.Stat(keyPath); err != nil {
		t.Skipf("private key %s unavailable: %v", keyPath, err)
	}
	if _, err := os.Stat(knownHosts); err != nil {
		t.Skipf("known_hosts unavailable: %v", err)
	}

	dialer := &Dialer{
		Timeout:        20 * time.Second,
		KnownHostsFile: knownHosts,
	}

	target := devices.Target{
		Host:    host,
		Port:    22,
		User:    user,
		KeyPath: keyPath,
		// Go's SSH client does not read ~/.ssh/config, so the Tailscale alias
		// used to dial does not match the name the key is recorded under.
		HostKeyAlias: envOr("HELIOS_SSH_ALIAS", "kooshas-laptop.tail2b570.ts.net"),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	conn, err := dialer.Dial(ctx, target)
	if err != nil {
		t.Fatalf("Dial(%s): %v", target.Addr(), err)
	}
	defer conn.Close()

	// Host key verification is the point of this test, so prove a wong key is
	// rejected against the same real server rather than only in a unit test.
	t.Run("rejects a host key that is not in known_hosts", func(t *testing.T) {
		bad := &Dialer{
			Timeout:        20 * time.Second,
			KnownHostsFile: writeKnownHosts(t, "unrelated.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7ZQ4hK7fYy0lSLpQ7ZxLOzPZ3s2Q8nR9cQ0fSMr9Xa"),
		}
		if _, err := bad.Dial(ctx, target); err == nil {
			t.Fatal("dialer accepted a server whose key is absent from known_hosts")
		} else if !strings.Contains(err.Error(), "not in") && !strings.Contains(err.Error(), "mismatch") {
			t.Errorf("rejection should be a host key failure, got: %v", err)
		}
	})

	t.Run("reports the remote platform", func(t *testing.T) {
		res, err := conn.Run(ctx, "uname -s")
		if err != nil {
			t.Fatalf("Run(uname -s): %v", err)
		}
		if res.ExitCode != 0 {
			t.Fatalf("uname -s exited %d, stderr: %s", res.ExitCode, res.Stderr)
		}
		if got := strings.TrimSpace(res.Stdout); got != "Darwin" {
			t.Errorf("uname -s = %q, want Darwin (the MacBook is the shipping target)", got)
		}
	})

	// A non-zero exit must come back as a result, not as a transport error.
	t.Run("non-zero exit is a result, not an error", func(t *testing.T) {
		res, err := conn.Run(ctx, "exit 42")
		if err != nil {
			t.Fatalf("Run(exit 42) returned a transport error: %v", err)
		}
		if res.ExitCode != 42 {
			t.Errorf("ExitCode = %d, want 42", res.ExitCode)
		}
	})

	t.Run("captures stderr separately", func(t *testing.T) {
		res, err := conn.Run(ctx, "echo out; echo err 1>&2")
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if strings.TrimSpace(res.Stdout) != "out" {
			t.Errorf("stdout = %q, want out", res.Stdout)
		}
		if strings.TrimSpace(res.Stderr) != "err" {
			t.Errorf("stderr = %q, want err", res.Stderr)
		}
	})

	// Cancelling must not hang; ssh.Session.Run cannot be interrupted directly,
	// so this verifies the goroutine plus session-close path works.
	t.Run("cancellation returns promptly", func(t *testing.T) {
		shortCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer cancel()

		start := time.Now()
		_, err := conn.Run(shortCtx, "sleep 30")
		elapsed := time.Since(start)

		if err == nil {
			t.Fatal("expected a context error from an interrupted command")
		}
		if elapsed > 15*time.Second {
			t.Errorf("cancellation took %v; the session was not closed", elapsed)
		}
	})
}
