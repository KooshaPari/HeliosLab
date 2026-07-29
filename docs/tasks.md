# Benchmark Tasks

HeliosBench ships with Terminal-Bench-style task definitions that exercise
common coding-agent behavior.

| Task ID | Category | Difficulty | Purpose |
| --- | --- | --- | --- |
| `palindrome` | code completion | easy | Implement a palindrome checker. |
| `fibonacci` | code completion | medium | Implement a Fibonacci sequence generator. |
| `buggy_add` | code review | easy | Find defects in a small addition function. |
| `refactor_loop` | refactoring | easy | Convert a loop into a clearer list-comprehension style. |
| `debug_division` | debugging | easy | Identify and fix a division bug. |
| `write_tests` | test generation | medium | Generate pytest unit tests. |
| `bayesian_sampler` | scientific computing | hard | Implement adaptive rejection sampling. |
| `log_parser` | system administration | medium | Parse logs and extract errors. |

## Output Metrics

- Mean, median, and standard deviation latency.
- Mean and maximum RSS memory.
- Mean and maximum CPU use.
- File descriptor counts.
- Thread counts.

Prefer JSON output when feeding results into dashboards or regression gates.
