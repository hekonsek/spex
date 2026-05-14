# Terminal session script instructions

## Accessing logs from local filesystem 

- Read `~/.cache/script` directory, to access terminal script session logs when needed.
- You can also rely on Linux file timestamps to see when file was updated.

## Logs format

- Terminal session script logs are generated using standard Linux `script` command.
- Terminal session script logs are named with timestamp indicating when session started.

## How to make use of terminal session script logs

- When you are asked about some problem related to CLI, check for recently updated terminal session scripts and see if you can see activities related to this topic.
- Check primarily in the most recent logs. Fallback to older ones if necessary.
- When user is refering to terminal name like *raven terminal*, check if there are logs with shell prompt including `raven` name (most likely generated with `scriptz prompt` command)

## Examples

When you are working on Python application and user is complaining that something is not working, look for the latest terminal session logs to see if there is soemthing related to the complaint.

When you are working on Terraform and user is complaining that something is not working, check recent terminal session logs to see if he/she tried to applied Terraform files you're currently working on.

When user is referring to the terminal name (for example *I see error in raven terminal*), check if there is a log file with given hostname (for example *raven*) in its prompt. Most likely user used `scriptz prompt` command to generate unique name for that terminal.