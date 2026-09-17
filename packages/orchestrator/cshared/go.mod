// Nested module so the parent module's `go test ./...` never tries to build
// cgo code, which would fail on a machine without a C toolchain.
//
// Run `go mod tidy` here once a C compiler is available.
module github.com/helioslab/orchestrator/cshared

go 1.23

require github.com/helioslab/orchestrator v0.0.0

replace github.com/helioslab/orchestrator => ../
