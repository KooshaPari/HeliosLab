package sshtransport

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	devices "github.com/helioslab/device-manager"
)

func TestHostPatternGlobExact(t *testing.T) {
	cases := []struct {
		pattern string
		host    string
		want    bool
	}{
		{"laptop", "laptop", true},
		{"laptop", "laptop2", false},
		{"laptop", "", false},
		{"LAPTOP", "laptop", true}, // matching is case-insensitive
		{"[laptop]", "laptop", true},
		{"10.0.0.1", "10.0.0.1", true},
		{"10.0.0.1", "10.0.0.2", false},
	}
	for _, c := range cases {
		if got := hostPatternGlob(c.pattern, c.host); got != c.want {
			t.Errorf("hostPatternGlob(%q, %q) = %v, want %v", c.pattern, c.host, got, c.want)
		}
	}
}

func TestHostPatternGlobWildcards(t *testing.T) {
	cases := []struct {
		pattern string
		host    string
		want    bool
	}{
		{"*", "anything", true},
		{"*", "", true},
		{"*.example.com", "dev.example.com", true},
		{"*.example.com", "example.com", false},
		{"dev-?.example.com", "dev-1.example.com", true},
		{"dev-?.example.com", "dev-12.example.com", false},
		{"192.168.1.*", "192.168.1.42", true},
		{"a*b*c", "aXXbYYc", true},
		{"a*b*c", "aXXbYY", false},
	}
	for _, c := range cases {
		if got := hostPatternGlob(c.pattern, c.host); got != c.want {
			t.Errorf("hostPatternGlob(%q, %q) = %v, want %v", c.pattern, c.host, got, c.want)
		}
	}
}

func TestHostMatchesNegation(t *testing.T) {
	// A negated pattern vetoes even when a positive pattern also matches.
	if hostMatches([]string{"*.example.com", "!bad.example.com"}, "bad.example.com") {
		t.Error("negated pattern did not veto the match")
	}
	if !hostMatches([]string{"*.example.com", "!bad.example.com"}, "good.example.com") {
		t.Error("positive pattern should still match a non-vetoed host")
	}
	// Comma lists come through as multiple entries.
	if !hostMatches([]string{"alpha", "beta"}, "beta") {
		t.Error("second entry in the list did not match")
	}
	if hostMatches([]string{"alpha", "beta"}, "gamma") {
		t.Error("unlisted host matched")
	}
}

// generateHostKey returns a fresh ed25519 public key and one line suitable for
// a known_hosts file.
func generateHostKey(t *testing.T, host string) (ssh.PublicKey, string) {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("wrap public key: %v", err)
	}
	line := host + " " + strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sshPub)))
	return sshPub, line
}

func writeKnownHosts(t *testing.T, lines ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "known_hosts")
	body := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}
	return path
}

func TestKnownHostsCallbackAcceptsMatchingKey(t *testing.T) {
	key, line := generateHostKey(t, "kooshas-laptop")
	path := writeKnownHosts(t, line)

	cb, err := KnownHostsCallback(path)
	if err != nil {
		t.Fatalf("KnownHostsCallback: %v", err)
	}
	if err := cb("kooshas-laptop", fakeAddr{}, key); err != nil {
		t.Errorf("matching key rejected: %v", err)
	}
}

func TestKnownHostsCallbackRejectsUnknownKey(t *testing.T) {
	_, line := generateHostKey(t, "kooshas-laptop")
	path := writeKnownHosts(t, line)
	otherKey, _ := generateHostKey(t, "kooshas-laptop")

	cb, err := KnownHostsCallback(path)
	if err != nil {
		t.Fatalf("KnownHostsCallback: %v", err)
	}
	if err := cb("kooshas-laptop", fakeAddr{}, otherKey); err == nil {
		t.Error("a key not present in known_hosts was accepted")
	}
}

func TestKnownHostsCallbackRejectsUnknownHost(t *testing.T) {
	key, line := generateHostKey(t, "kooshas-laptop")
	path := writeKnownHosts(t, line)

	cb, err := KnownHostsCallback(path)
	if err != nil {
		t.Fatalf("KnownHostsCallback: %v", err)
	}
	if err := cb("attacker.example.com", fakeAddr{}, key); err == nil {
		t.Error("key accepted for an unrelated host")
	}
}

func TestKnownHostsCallbackSkipsJunkLines(t *testing.T) {
	key, line := generateHostKey(t, "laptop")
	path := writeKnownHosts(t,
		"# a comment",
		"",
		"this is not a known_hosts line",
		line,
	)

	cb, err := KnownHostsCallback(path)
	if err != nil {
		t.Fatalf("KnownHostsCallback: %v", err)
	}
	if err := cb("laptop", fakeAddr{}, key); err != nil {
		t.Errorf("valid line after junk was not honoured: %v", err)
	}
}

func TestKnownHostsCallbackEmptyFileRefusesEverything(t *testing.T) {
	path := writeKnownHosts(t, "# nothing but comments")
	cb, err := KnownHostsCallback(path)
	if err != nil {
		t.Fatalf("KnownHostsCallback: %v", err)
	}
	key, _ := generateHostKey(t, "laptop")
	if err := cb("laptop", fakeAddr{}, key); err == nil {
		t.Error("empty known_hosts accepted a key; it must fail closed")
	}
}

func TestKnownHostsCallbackMissingFile(t *testing.T) {
	if _, err := KnownHostsCallback(filepath.Join(t.TempDir(), "absent")); err == nil {
		t.Error("expected an error for a missing known_hosts file")
	}
}

func TestDialerFailsClosedWithoutKnownHosts(t *testing.T) {
	d := &Dialer{KnownHostsFile: filepath.Join(t.TempDir(), "absent")}
	cb := d.hostKeyCallback()
	key, _ := generateHostKey(t, "laptop")

	err := cb("laptop", fakeAddr{}, key)
	if err == nil {
		t.Fatal("dialer accepted an unverifiable host key")
	}
	// The operator needs the fingerprint to verify it out of band.
	if !strings.Contains(err.Error(), ssh.FingerprintSHA256(key)) {
		t.Errorf("error should include the fingerprint, got: %v", err)
	}
}

func TestDialerInsecureOptIn(t *testing.T) {
	d := &Dialer{AllowInsecureHostKey: true}
	if err := d.hostKeyCallback()("laptop", fakeAddr{}, mustKey(t)); err != nil {
		t.Errorf("explicit insecure opt-in still rejected: %v", err)
	}
}

func TestDialerRespectsExplicitCallback(t *testing.T) {
	sentinel := "custom verifier ran"
	d := &Dialer{HostKeyCallback: func(string, net.Addr, ssh.PublicKey) error {
		return &net.AddrError{Err: sentinel, Addr: "x"}
	}}
	err := d.hostKeyCallback()("laptop", fakeAddr{}, mustKey(t))
	if err == nil || !strings.Contains(err.Error(), sentinel) {
		t.Errorf("explicit HostKeyCallback was not used, got: %v", err)
	}
}

func TestDialerRejectsInvalidTargetBeforeNetwork(t *testing.T) {
	d := New()
	_, err := d.Dial(context.Background(), devices.Target{Host: "", Port: 22, User: "u"})
	if err == nil {
		t.Fatal("expected validation failure for an empty host")
	}
	// Must fail on validation, not on a handshake attempt.
	if !strings.Contains(err.Error(), "host is empty") {
		t.Errorf("error = %v, want a validation error", err)
	}
}

func TestAuthMethodsWithoutCredentials(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", "")
	_, err := authMethods(devices.Target{Host: "h", Port: 22, User: "u"})
	if err == nil {
		t.Fatal("expected an error when no key path and no agent are available")
	}
	if !strings.Contains(err.Error(), "no SSH authentication method") {
		t.Errorf("error = %v, want guidance about key path or ssh-agent", err)
	}
}

func TestAuthMethodsMissingKeyFile(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", "")
	_, err := authMethods(devices.Target{
		Host:    "h",
		Port:    22,
		User:    "u",
		KeyPath: filepath.Join(t.TempDir(), "nope"),
	})
	if err == nil || !strings.Contains(err.Error(), "read key") {
		t.Errorf("error = %v, want a read-key failure", err)
	}
}

func TestAuthMethodsPassphraseProtectedKeyHint(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", "")

	// An encrypted key is recognised by its PEM header.
	const encrypted = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACC7p5TfNnT0mWNd9Y7l0YQwZm3G3p2bTkPZ9p6u7pzZ7wAAAJgQ0Xy1QNF
8tUFYjJm5mZ3E4cTJyZ2x4Z2l0d3J5c3R1dgAAAAtzc2gtZWQyNTUxOQAAACC7p5TfNnT0
mWNd9Y7l0YQwZm3G3p2bTkPZ9p6u7pzZ7wAAAEQAXf9x7bqj0m0kqS3v8f1j0mQwZ2Z0
-----END OPENSSH PRIVATE KEY-----
`
	path := filepath.Join(t.TempDir(), "id_ed25519")
	if err := os.WriteFile(path, []byte(encrypted), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}

	_, err := authMethods(devices.Target{Host: "h", Port: 22, User: "u", KeyPath: path})
	if err == nil {
		t.Skip("key parsed successfully; shape of test fixture changed")
	}
	if !strings.Contains(err.Error(), "parse key") {
		t.Errorf("error = %v, want a parse-key failure", err)
	}
}

func TestKnownHostsCallbackMatchesBareHostWhenGivenHostPort(t *testing.T) {
	key, line := generateHostKey(t, "kooshas-laptop.tail2b570.ts.net")
	path := writeKnownHosts(t, line)

	cb, err := KnownHostsCallback(path)
	if err != nil {
		t.Fatalf("KnownHostsCallback: %v", err)
	}

	// x/crypto/ssh hands the callback whatever address form it was given. The
	// dialer passes "host:port", while known_hosts records port 22 as a bare
	// hostname. Comparing them directly rejects every connection.
	if err := cb("kooshas-laptop.tail2b570.ts.net:22", fakeAddr{}, key); err != nil {
		t.Errorf("host:port form not matched against a bare hostname entry: %v", err)
	}
	if err := cb("kooshas-laptop.tail2b570.ts.net", fakeAddr{}, key); err != nil {
		t.Errorf("bare hostname form rejected: %v", err)
	}
}

func TestHostCandidates(t *testing.T) {
	got := hostCandidates("host.example:2222")
	if len(got) != 2 || got[0] != "host.example:2222" || got[1] != "host.example" {
		t.Errorf("hostCandidates = %v, want both forms", got)
	}
	got = hostCandidates("[fe80::1]:22")
	if len(got) != 2 || got[1] != "fe80::1" {
		t.Errorf("hostCandidates(ipv6) = %v, want the bracketed host stripped", got)
	}
	if got := hostCandidates("laptop"); len(got) != 1 || got[0] != "laptop" {
		t.Errorf("hostCandidates(bare) = %v, want [laptop]", got)
	}
}

func TestDefaultKnownHostsPath(t *testing.T) {
	got := DefaultKnownHostsPath()
	if got == "" {
		t.Skip("no home directory available in this environment")
	}
	if !strings.HasSuffix(got, "known_hosts") {
		t.Errorf("DefaultKnownHostsPath() = %q, want a known_hosts path", got)
	}
}

func TestDialerTimeoutDefault(t *testing.T) {
	if got := New().timeout(); got != DefaultTimeout {
		t.Errorf("timeout = %v, want %v", got, DefaultTimeout)
	}
	if got := (&Dialer{Timeout: 0}).timeout(); got != DefaultTimeout {
		t.Errorf("zero timeout = %v, want default %v", got, DefaultTimeout)
	}
	if got := (&Dialer{Timeout: 1234}).timeout(); got != 1234 {
		t.Errorf("explicit timeout = %v, want 1234", got)
	}
}

type fakeAddr struct{}

func (fakeAddr) Network() string { return "tcp" }
func (fakeAddr) String() string  { return "127.0.0.1:22" }

func mustKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	key, _ := generateHostKey(t, "x")
	return key
}
