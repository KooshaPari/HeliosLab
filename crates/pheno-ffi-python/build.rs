fn main() {
    if pyo3_build_config::get()
        .python_framework_prefix
        .as_deref()
        .is_some_and(|prefix| !prefix.is_empty())
    {
        pyo3_build_config::add_python_framework_link_args();
    }
}
