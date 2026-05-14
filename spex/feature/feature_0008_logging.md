# Logging

Spex is using Pino as logging framework. Default logging level is `silent`. It can be changed to diffrent level using `--logging` CLI option. The idea is that by default stdout is not polluted by logging and can be enabled for debugging as needed.