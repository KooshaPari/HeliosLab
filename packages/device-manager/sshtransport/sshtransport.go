// Package sshtransport provides the concrete SSH implementation of
// devicemanager.Dialer.
//
// It is deliberately kept out of the cgo shim so that it compiles and can be
// tested without a C toolchain.
//
// Security posture: host keys are verified. The previous implementation used
// ssh.InsecureIgnoreHostKey, which accepts any key an attacker presents and
// makes the whole connection trivially interceptable. Here, an unconfigured
// dialer refuses to connect unless the caller explicitly opts out.
package sshtransport

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	devices "github.com/helioslab/device-manager"
)

// DefaultTimeout bounds the TCP dial and SSH handshake.
const DefaultTimeout = 15 * time.Second

// Dialer opens SSH connections.
type Dialer struct {
	// Timeout bounds dial and handshake. Defaults to DefaultTimeout.
	Timeout time.Duration
	// KnownHostsFile is the OpenSSH known_hosts file used to verify host keys.
	// When empty, ~/.ssh/known_hosts is tried, and if that is missing the
	// dialer refuses to connect.
	KnownHostsFile string
	// HostKeyCallback overrides host key verification entirely. Intended for
	// tests and for callers that manage trust out of band.
	HostKeyCallback ssh.HostKeyCallback
	// AllowInsecureHostKey disables verification. Only ever set this
	// deliberately; it makes the connection interceptable.
	AllowInsecureHostKey bool
}

// New returns a Dialer with default timeouts and host key verification.
func New() *Dialer {
	return &Dialer{Timeout: DefaultTimeout}
}

// Dial implements devices.Dialer.
func (d *Dialer) Dial(ctx context.Context, t devices.Target) (devices.Conn, error) {
	if err := t.Validate(); err != nil {
		return nil, err
	}

	auth, err := authMethods(t)
	if err != nil {
		return nil, err
	}

	cfg := &ssh.ClientConfig{
		User:            t.User,
		Auth:            auth,
		Timeout:         d.timeout(),
		HostKeyCallback: d.hostKeyCallback(),
	}

	var nd net.Dialer
	netConn, err := nd.DialContext(ctx, "tcp", t.Addr())
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", t.Addr(), err)
	}

	clientConn, chans, reqs, err := ssh.NewClientConn(netConn, t.Addr(), cfg)
	if err != nil {
		_ = netConn.Close()
		return nil, fmt.Errorf("ssh handshake with %s: %w", t.Addr(), err)
	}

	return &conn{client: ssh.NewClient(clientConn, chans, reqs)}, nil
}

func (d *Dialer) timeout() time.Duration {
	if d.Timeout > 0 {
		return d.Timeout
	}
	return DefaultTimeout
}

func (d *Dialer) hostKeyCallback() ssh.HostKeyCallback {
	if d.HostKeyCallback != nil {
		return d.HostKeyCallback
	}
	if d.AllowInsecureHostKey {
		return ssh.InsecureIgnoreHostKey()
	}

	path := d.KnownHostsFile
	if path == "" {
		path = DefaultKnownHostsPath()
	}
	if path != "" {
		if cb, err := KnownHostsCallback(path); err == nil {
			return cb
		}
	}

	// Fail closed. Reporting the fingerprint lets an operator verify it out of
	// band instead of blindly trusting it.
	return func(hostname string, _ net.Addr, key ssh.PublicKey) error {
		return fmt.Errorf(
			"no known_hosts available; refusing to connect to %s (server key %s)",
			hostname, ssh.FingerprintSHA256(key),
		)
	}
}

// DefaultKnownHostsPath returns ~/.ssh/known_hosts, or "" when unresolvable.
func DefaultKnownHostsPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return home + string(os.PathSeparator) + ".ssh" + string(os.PathSeparator) + "known_hosts"
}

type knownHost struct {
	hosts []string
	key   ssh.PublicKey
}

// KnownHostsCallback builds a host key verifier from an OpenSSH known_hosts
// file. Unparseable lines (comments, blank lines, unsupported key types) are
// skipped; an error is returned only when the file cannot be read at all.
func KnownHostsCallback(path string) (ssh.HostKeyCallback, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []knownHost
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		_, hosts, key, _, _, err := ssh.ParseKnownHosts([]byte(sc.Text()))
		if err != nil {
			continue // comment, blank line, or an unsupported key type
		}
		entries = append(entries, knownHost{hosts: hosts, key: key})
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}

	if len(entries) == 0 {
		return func(hostname string, _ net.Addr, key ssh.PublicKey) error {
			return fmt.Errorf("no usable host keys in %s; cannot verify %s", path, hostname)
		}, nil
	}

	return func(hostname string, _ net.Addr, key ssh.PublicKey) error {
		for _, e := range entries {
			if !hostMatches(e.hosts, hostname) {
				continue
			}
			if bytes.Equal(e.key.Marshal(), key.Marshal()) {
				return nil
			}
		}
		return fmt.Errorf(
			"host key mismatch for %s: presented %s is not in %s",
			hostname, ssh.FingerprintSHA256(key), path,
		)
	}, nil
}

// hostMatches implements the host pattern rules from sshd(8): exact names,
// comma-separated lists, and the `!` negation prefix.
func hostMatches(patterns []string, hostname string) bool {
	// A negated pattern anywhere in the list vetoes the match outright.
	for _, p := range patterns {
		if strings.HasPrefix(p, "!") && hostPatternGlob(strings.TrimPrefix(p, "!"), hostname) {
			return false
		}
	}
	for _, p := range patterns {
		if strings.HasPrefix(p, "!") {
			continue
		}
		if hostPatternGlob(p, hostname) {
			return true
		}
	}
	return false
}

// hostPatternGlob matches a single known_hosts pattern against a hostname.
// Supports `*` (any run of characters) and `?` (any single character).
func hostPatternGlob(pattern, hostname string) bool {
	pattern = strings.ToLower(pattern)
	hostname = strings.ToLower(hostname)

	if !strings.ContainsAny(pattern, "*?") {
		// A bare [host]:port entry also matches the plain hostname.
		return pattern == hostname || pattern == "["+hostname+"]"
	}

	var (
		p   int
		h   int
		star = -1
		mark int
	)
	for h < len(hostname) {
		if p < len(pattern) && (pattern[p] == '?' || pattern[p] == hostname[h]) {
			p++
			h++
			continue
		}
		if p < len(pattern) && pattern[p] == '*' {
			star = p
			mark = h
			p++
			continue
		}
		if star >= 0 {
			p = star + 1
			mark++
			h = mark
			continue
		}
		return false
	}
	for p < len(pattern) && pattern[p] == '*' {
		p++
	}
	return p == len(pattern)
}

// authMethods assembles the authentication methods for a target.
func authMethods(t devices.Target) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod

	if t.KeyPath != "" {
		pem, err := os.ReadFile(t.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("read key %s: %w", t.KeyPath, err)
		}
		signer, err := ssh.ParsePrivateKey(pem)
		if err != nil {
			var passphraseErr *ssh.PassphraseMissingError
			if errors.As(err, &passphraseErr) {
				return nil, fmt.Errorf(
					"key %s is passphrase-protected; unlock it into ssh-agent first",
					t.KeyPath,
				)
			}
			return nil, fmt.Errorf("parse key %s: %w", t.KeyPath, err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		agentConn, err := net.Dial("unix", sock)
		if err == nil {
			agentClient := agent.NewClient(agentConn)
			methods = append(methods, ssh.PublicKeysCallback(agentClient.Signers))
		}
	}

	if len(methods) == 0 {
		return nil, errors.New(
			"no SSH authentication method available: set a key path or start ssh-agent",
		)
	}
	return methods, nil
}

// conn adapts an ssh.Client to devices.Conn.
type conn struct {
	client *ssh.Client
}

// Run executes a command. A non-zero exit status is returned as a result, not
// as an error: it is a successful round trip that reports failure.
func (c *conn) Run(ctx context.Context, command string) (devices.ExecResult, error) {
	session, err := c.client.NewSession()
	if err != nil {
		return devices.ExecResult{}, fmt.Errorf("open session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	// ssh.Session.Run cannot be cancelled directly, so run it on a goroutine and
	// close the session if the caller's context expires.
	done := make(chan error, 1)
	go func() { done <- session.Run(command) }()

	select {
	case <-ctx.Done():
		_ = session.Signal(ssh.SIGKILL)
		_ = session.Close()
		return devices.ExecResult{
			Stdout: stdout.String(),
			Stderr: stderr.String(),
		}, ctx.Err()

	case err := <-done:
		res := devices.ExecResult{
			Stdout: stdout.String(),
			Stderr: stderr.String(),
		}
		if err == nil {
			return res, nil
		}
		var exitErr *ssh.ExitError
		if errors.As(err, &exitErr) {
			res.ExitCode = exitErr.ExitStatus()
			return res, nil
		}
		var missingErr *ssh.ExitMissingError
		if errors.As(err, &missingErr) {
			res.ExitCode = -1
			return res, nil
		}
		return res, err
	}
}

// Close implements devices.Conn.
func (c *conn) Close() error {
	if c.client == nil {
		return nil
	}
	return c.client.Close()
}
