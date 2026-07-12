# WSD model tools

Owner: Polycast model pipeline. Status: maintained offline research tooling; never imported by production runtime.

Create an isolated Python 3.11 environment and install `requirements.lock`. Every executable exposes `--help`; use a tiny fixture/sample path and an output directory under `/tmp` for a safe smoke run. Training and benchmark commands may download large third-party models, so they are intentionally not part of the normal application check. `wsdBenchmarkCommon.py` is shared library code, not an executable.

Outputs are model artifacts and JSON benchmark reports. Keep them outside the repository (the defaults use `/tmp` or ignored model-cache locations). Production adoption requires a separately reviewed model license, size/latency benchmark, fallback diagnostic path, and dependency/security review.
