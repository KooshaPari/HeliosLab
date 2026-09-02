from importlib.metadata import metadata, version

import phenotype_config


assert version("phenotype-config") == "0.14.11.dev3"
package_metadata = metadata("phenotype-config")
assert package_metadata["Requires-Python"] == ">=3.9"
assert package_metadata["License-Expression"] == "MIT OR Apache-2.0"

config = phenotype_config.PhenoConfig(":memory:", "smoke")
config.set("theme", "dark")
assert config.get("theme") == ("theme", "dark", "string")

flags = phenotype_config.FeatureFlags(":memory:", "smoke")
flags.create("new-ui", "smoke flag")
flags.enable("new-ui")
assert flags.list() == [("new-ui", True, "smoke flag")]

secrets = phenotype_config.Secrets(":memory:", "00" * 32)
secrets.set("token", "secret")
assert secrets.get("token") == "secret"

versions = phenotype_config.VersionInfoPy(":memory:")
versions.bump("helioslab", "1.2.3")
versions.sync("helioslab", "2.0.0")
assert [(repo, ours, upstream) for repo, ours, upstream, _ in versions.show()] == [
    ("helioslab", "1.2.3", "2.0.0")
]
