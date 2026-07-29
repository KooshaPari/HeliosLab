import subprocess
from unittest.mock import MagicMock, call, patch

import pytest

from helios_bench import (
    BenchmarkResult,
    BenchmarkRunner,
    LeakDetector,
    ResourceMonitor,
    ResourceStats,
    RunResult,
    _kill_process_tree,
    main,
)
from helios_bench.tasks import (
    BenchmarkTask,
    export_tasks_json,
    get_all_tasks,
    get_task,
    get_tasks_by_category,
    get_tasks_by_difficulty,
)


@pytest.fixture
def benchmark_task():
    return BenchmarkTask(
        id="test_task",
        name="Test Task",
        category="code_completion",
        difficulty="easy",
        prompt="Write a function; echo unsafe",
        timeout=10,
        max_tokens=10,
    )


def test_resource_stats_defaults():
    stats = ResourceStats()
    assert stats.rss_mean_mb == 0
    assert stats.rss_max_mb == 0
    assert stats.cpu_mean_percent == 0
    assert stats.cpu_max_percent == 0
    assert stats.threads_mean == 0
    assert stats.threads_max == 0
    assert stats.fds_mean == 0
    assert stats.fds_max == 0
    assert stats.samples == 0


def test_trend_calculation():
    detector = LeakDetector()
    # Test flat trend
    assert detector._calc_trend([10.0, 10.0, 10.0, 10.0]) == 0.0
    # Test positive trend
    assert detector._calc_trend([1.0, 2.0, 3.0, 4.0]) > 0
    # Test negative trend
    assert detector._calc_trend([4.0, 3.0, 2.0, 1.0]) < 0
    # Empty/single elements
    assert detector._calc_trend([]) == 0.0
    assert detector._calc_trend([5.0]) == 0.0


@patch("psutil.Process")
def test_resource_monitor_aggregation(mock_process_class):
    mock_process = MagicMock()
    mock_process.is_running.return_value = True

    mock_mem = MagicMock()
    mock_mem.rss = 1048576 * 150  # 150 MB
    mock_process.memory_info.return_value = mock_mem
    mock_process.cpu_percent.return_value = 15.0
    mock_process.num_threads.return_value = 4
    mock_process.num_fds.return_value = 12

    mock_process_class.return_value = mock_process

    monitor = ResourceMonitor(sample_interval=0.01)
    # Inject mock process directly
    monitor._process = mock_process
    monitor.samples = [
        {"rss_mb": 100.0, "cpu_percent": 10.0, "threads": 2, "fds": 10},
        {"rss_mb": 200.0, "cpu_percent": 20.0, "threads": 4, "fds": 20},
    ]

    stats = monitor.aggregate()
    assert stats.rss_mean_mb == 150.0
    assert stats.rss_max_mb == 200.0
    assert stats.cpu_mean_percent == 15.0
    assert stats.cpu_max_percent == 20.0
    assert stats.threads_mean == 3.0
    assert stats.threads_max == 4
    assert stats.fds_mean == 15.0
    assert stats.fds_max == 20
    assert stats.samples == 2


@patch("psutil.Process")
@patch("threading.Thread")
def test_resource_monitor_lifecycle(mock_thread_class, mock_process_class):
    mock_process = MagicMock()
    mock_process_class.return_value = mock_process

    monitor = ResourceMonitor(sample_interval=0.01)
    monitor.start(1234)
    assert monitor._running is True
    assert monitor._process == mock_process

    samples = monitor.stop()
    assert monitor._running is False
    assert isinstance(samples, list)
    assert monitor._process is None
    assert monitor._thread is None


@patch("psutil.Process")
def test_resource_monitor_start_failure_is_observable(mock_process_class):
    mock_process_class.side_effect = __import__("psutil").NoSuchProcess(1234)
    monitor = ResourceMonitor()

    assert monitor.start(1234) is False
    assert monitor._running is False
    assert monitor.last_error.startswith("NoSuchProcess:")


@pytest.mark.parametrize("interval", [0, -0.1, float("inf"), float("nan")])
def test_resource_monitor_rejects_invalid_interval(interval):
    with pytest.raises(ValueError, match="sample_interval"):
        ResourceMonitor(interval)


def test_resource_monitor_loop_collects_sample():
    process = MagicMock()
    process.is_running.return_value = True
    process.memory_info.return_value.rss = 1024 * 1024
    process.cpu_percent.return_value = 3.0
    process.num_threads.return_value = 2
    process.num_fds.return_value = 4
    monitor = ResourceMonitor()
    monitor._running = True
    monitor._process = process
    with patch("helios_bench.time.sleep", side_effect=lambda _: setattr(monitor, "_running", False)):
        monitor._monitor_loop()
    assert monitor.samples == [{
        "rss_mb": 1.0, "cpu_percent": 3.0, "threads": 2, "fds": 4,
    }]


@patch("helios_bench.psutil.Process")
def test_kill_process_tree_kills_children_and_reaps_root(mock_process):
    child_a = MagicMock()
    child_b = MagicMock()
    mock_process.return_value.children.return_value = [child_a, child_b]
    proc = MagicMock(pid=99)

    _kill_process_tree(proc)

    child_a.kill.assert_called_once_with()
    child_b.kill.assert_called_once_with()
    proc.kill.assert_called_once_with()
    proc.wait.assert_called_once_with()


@patch("subprocess.Popen")
@patch("helios_bench.ResourceMonitor")
def test_benchmark_runner_run_task(mock_monitor_class, mock_popen, benchmark_task):
    mock_proc = MagicMock()
    mock_proc.pid = 1234
    mock_proc.returncode = 0
    mock_popen.return_value = mock_proc

    mock_monitor = MagicMock()
    mock_monitor_class.return_value = mock_monitor
    mock_stats = ResourceStats(rss_max_mb=100.0, cpu_max_percent=25.0, samples=5)
    mock_monitor.aggregate.return_value = mock_stats

    runner = BenchmarkRunner(binary="dummy-binary")
    result = runner.run_task(benchmark_task)

    assert isinstance(result, RunResult)
    assert result.success is True
    assert result.resources.rss_max_mb == 100.0
    assert result.resources.cpu_max_percent == 25.0

    mock_popen.assert_called_once_with(
        [
            "dummy-binary",
            "exec",
            "--profile",
            "proxy-minimax",
            "--model",
            "minimax-m2.5",
            "--skip-git-repo-check",
            benchmark_task.prompt,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    mock_monitor.start.assert_called_with(1234)
    mock_monitor.stop.assert_called_once_with()
    mock_monitor.aggregate.assert_called_once()


@patch("helios_bench._kill_process_tree")
@patch("subprocess.Popen")
@patch("helios_bench.ResourceMonitor")
def test_benchmark_timeout_stops_monitor_and_kills_tree(
    mock_monitor_class, mock_popen, mock_kill_tree, benchmark_task
):
    proc = MagicMock(pid=42, returncode=-9)
    proc.wait.side_effect = subprocess.TimeoutExpired("benchmark", benchmark_task.timeout)
    mock_popen.return_value = proc
    mock_monitor_class.return_value.aggregate.return_value = ResourceStats()

    result = BenchmarkRunner("binary").run_task(benchmark_task)

    assert result.success is False
    assert result.timed_out is True
    assert "timed out" in result.error
    mock_kill_tree.assert_called_once_with(proc)
    mock_monitor_class.return_value.stop.assert_called_once_with()


@patch("subprocess.Popen", side_effect=FileNotFoundError("missing"))
@patch("helios_bench.ResourceMonitor")
def test_benchmark_start_failure_returns_traceable_red(
    mock_monitor_class, _mock_popen, benchmark_task
):
    mock_monitor_class.return_value.aggregate.return_value = ResourceStats()

    result = BenchmarkRunner("missing-binary").run_task(benchmark_task)

    assert result.success is False
    assert result.exit_code is None
    assert result.error == "failed to start benchmark: missing"
    mock_monitor_class.return_value.stop.assert_called_once_with()


@patch("subprocess.Popen")
@patch("helios_bench.ResourceMonitor")
def test_benchmark_records_monitoring_failure(
    mock_monitor_class, mock_popen, benchmark_task
):
    proc = MagicMock(pid=42, returncode=0)
    mock_popen.return_value = proc
    monitor = mock_monitor_class.return_value
    monitor.start.return_value = False
    monitor.last_error = "AccessDenied: denied"
    monitor.aggregate.return_value = ResourceStats()

    result = BenchmarkRunner("binary").run_task(benchmark_task)

    assert result.success is True
    assert result.monitoring_error == "AccessDenied: denied"


def test_benchmark_rejects_non_positive_runs(benchmark_task):
    runner = BenchmarkRunner("binary")

    with pytest.raises(ValueError, match="runs"):
        runner.run_benchmark(benchmark_task, runs=0)


def test_compare_rejects_empty_results():
    empty = BenchmarkResult("a", "task", "Task", "cat", "easy", 0)
    runner = BenchmarkRunner("a")

    with pytest.raises(ValueError, match="no runs"):
        runner._compare_results(empty, empty)


def test_compare_handles_zero_baseline_without_dividing():
    resources = ResourceStats()
    a = BenchmarkResult(
        "a", "task", "Task", "cat", "easy", 1,
        [RunResult(1, 1.0, True, resources)],
    )
    b = BenchmarkResult(
        "b", "task", "Task", "cat", "easy", 1,
        [RunResult(1, 0.0, True, resources)],
    )
    assert BenchmarkRunner("a")._compare_results(a, b)["speedup"] is None


def test_leak_detector_resets_state_and_decreases_are_not_leaks(benchmark_task):
    detector = LeakDetector(runs=2, warmup=0)
    detector.results = [{"stale": True}]
    fresh = [
        {
            "elapsed": 1.0, "rss_mean_mb": 2.0, "rss_max_mb": 2.0,
            "cpu_mean": 0.0, "fds_max": 2, "success": True,
            "exit_code": 0, "timed_out": False, "error": None,
        },
        {
            "elapsed": 1.0, "rss_mean_mb": 1.0, "rss_max_mb": 1.0,
            "cpu_mean": 0.0, "fds_max": 1, "success": True,
            "exit_code": 0, "timed_out": False, "error": None,
        },
    ]
    with patch.object(detector, "_run_single", side_effect=fresh) as run:
        result = detector.detect("binary", benchmark_task)

    assert run.call_args_list == [
        call("binary", benchmark_task, "proxy-minimax"),
        call("binary", benchmark_task, "proxy-minimax"),
    ]
    assert len(detector.results) == 2
    assert result["memory"]["leak"] is False
    assert result["file_descriptors"]["leak"] is False
    assert result["healthy"] is True


def test_leak_detector_failed_run_is_unhealthy():
    detector = LeakDetector(runs=1, warmup=0)
    detector.results = [{
        "rss_max_mb": 1.0, "fds_max": 1, "success": False,
    }]
    assert detector._analyze_leaks()["healthy"] is False


def test_unknown_task_does_not_fall_back_to_palindrome():
    with pytest.raises(KeyError, match="unknown benchmark task"):
        get_task("typo")


def test_task_catalog_queries_and_export():
    assert get_task("palindrome").id == "palindrome"
    assert all(task.category == "debugging" for task in get_tasks_by_category("debugging"))
    assert all(task.difficulty == "easy" for task in get_tasks_by_difficulty("easy"))
    assert len(get_all_tasks()) >= 1
    assert json_loads(export_tasks_json())["palindrome"]["timeout"] == 20


def test_cli_tasks_command(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["helios-bench", "tasks", "--category", "debugging"])
    assert main() == 0
    output = capsys.readouterr().out
    assert "Fix Division Bug" in output
    assert "Palindrome Check" not in output


@patch("helios_bench.BenchmarkRunner")
def test_cli_run_serializes_result(mock_runner, monkeypatch, tmp_path, benchmark_task):
    result = BenchmarkResult(
        "binary", "palindrome", "Palindrome Check", "code_completion", "easy", 1,
        [RunResult(1, 1.0, True, ResourceStats(), exit_code=0)],
    )
    mock_runner.return_value.run_benchmark.return_value = result
    output = tmp_path / "result.json"
    monkeypatch.setattr(
        "sys.argv",
        ["helios-bench", "run", "--binary", "binary", "--runs", "1", "--output", str(output)],
    )
    assert main() == 0
    assert json_load(output)["run_results"][0]["exit_code"] == 0


@patch("helios_bench.BenchmarkRunner")
def test_cli_run_returns_red_when_a_benchmark_fails(mock_runner, monkeypatch, capsys):
    mock_runner.return_value.run_benchmark.return_value = BenchmarkResult(
        "binary", "palindrome", "Palindrome Check", "code_completion", "easy", 1,
        [RunResult(1, 1.0, False, ResourceStats(), exit_code=2, error="failed")],
    )
    monkeypatch.setattr("sys.argv", ["helios-bench", "run", "--binary", "binary"])
    assert main() == 1
    assert '"success": false' in capsys.readouterr().out


@patch("helios_bench.BenchmarkRunner")
def test_cli_compare_prints_result(mock_runner, monkeypatch, capsys):
    mock_runner.return_value.compare.return_value = {"speedup": None, "healthy": True}
    monkeypatch.setattr(
        "sys.argv",
        ["helios-bench", "compare", "--binary-a", "a", "--binary-b", "b"],
    )
    assert main() == 0
    assert '"speedup": null' in capsys.readouterr().out


@patch("helios_bench.LeakDetector")
def test_cli_leak_prints_result(mock_detector, monkeypatch, capsys):
    mock_detector.return_value.detect.return_value = {"healthy": False}
    monkeypatch.setattr("sys.argv", ["helios-bench", "leak", "--binary", "a"])
    assert main() == 1
    assert '"healthy": false' in capsys.readouterr().out


def json_load(path):
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def json_loads(value):
    import json

    return json.loads(value)
