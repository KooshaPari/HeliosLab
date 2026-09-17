// Nested module so the parent module's `go test ./...` never tries to build
// cgo code, which would fail on a machine without a C toolchain.
//
// Run `go mod tidy` here once a C compiler is available; it will add the
// golang.org/x/crypto requirement pulled in via sshtransport.
module github.com/helioslab/device-manager/cshared

go 1.23

require github.com/helioslab/device-manager v0.0.0

replace github.com/helioslab/device-manager => ../
