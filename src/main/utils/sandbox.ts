import { spawnSync } from "bun";
import { spawn } from "child_process";

export type SandboxRule = {
  action: string;
  resource: string;
  path?: string;
  ip?: string;
  regex?: string;
};

export type SandboxProfile = {
  version: number;
  default_rule: string;
  rules: SandboxRule[];
};

export const jsonToSBPL = (profile: SandboxProfile): string => {
  //   let sbpl = `(version ${profile.version})\n(${profile.default_rule} default)\n`;
  let sbpl = `(version ${profile.version})\n\n(${profile.default_rule} (with message "co(lab): default deny, see prev line in log") default)\n`;

  profile.rules.forEach((rule) => {
    // Note: if you run this in another terminal window
    // `log stream --style compact --info --debug  --predicate '(((processID == 0) AND (senderImagePath CONTAINS "/Sandbox")) OR (subsystem == "com.apple.sandbox.reporting"))'
    // and use (with message "some message") then you'll see the messages in the terminal
    // assuming you allow all and deny specific things with a message
    // let ruleStr = `(${rule.action} (with message "${rule.resource}") ${rule.resource}`;
    // let ruleStr = `(${rule.action} (with message "co(lab): ${rule.resource}") (with telemetry) ${rule.resource}`;
    let ruleStr = `(${rule.action} (with message "co(lab): deny ${rule.resource}") ${rule.resource}`;
    if (rule.path) {
      ruleStr += ` (subpath "${rule.path}"))`;
    } else if (rule.ip) {
      ruleStr += ` (remote ip "${rule.ip}"))`;
    } else if (rule.regex) {
      ruleStr += ` (regex "${rule.regex}"))`;
    } else {
      ruleStr += `)`;
    }
    sbpl += ruleStr + "\n";
  });

  return sbpl;
};

export const runCommandWithSandbox = (
  profile: SandboxProfile,
  command: string,
  args: string[]
): void => {
  const sbpl = jsonToSBPL(profile);
  const sandboxCommand = ["sandbox-exec", "-p", sbpl, command, ...args];

  const result = spawnSync(sandboxCommand);

  console.log(result.stdout.toString());
  console.error(result.stderr.toString());
};

export const sandboxSpawn = (
  profile: SandboxProfile,
  command: string,
  args: string[],
  options: any = {}
) => {
  const sbpl = jsonToSBPL(profile);

  const sandboxCommandArgs = ["-p", sbpl, command, ...args];

  return spawn("sandbox-exec", sandboxCommandArgs, options);
};

/**
Note: 
example .sb files in /System/Library/Sandbox/Profiles/ 

none of these seem to do anything locally (with report) or (with telemetry) or (with message "some message") to rules or (allow (with report) (with telemetry) default)

You can get a streaming log of sandbox denials with:
log stream --style compact --info --debug  --predicate '(((processID == 0) AND (senderImagePath CONTAINS "/Sandbox")) OR (subsystem == "com.apple.sandbox.reporting"))'

You can get a filtered version for the word "deny" with:
log stream --style compact --info --debug  --predicate '((((processID == 0) AND (senderImagePath CONTAINS "/Sandbox")) OR (subsystem == "com.apple.sandbox.reporting")) AND (message CONTAINS "deny"))'


Note: You can supposedly set 'sysctl security.mac.sandbox.debug_mode=544' to see verbose violation reporting.
and then use (with report)

You can use asterisks like file-read* to match multiple resources.

const comprehensive allow: SandboxProfile = {
  version: 1,
  default_rule: "deny",
  rules: [
    // file system access
    { "action": "allow", "resource": "file-read*" },
    { "action": "allow", "resource": "file-write*" },
    { "action": "allow", "resource": "file-read-data" },
    { "action": "allow", "resource": "file-read-metadata" },
    { "action": "allow", "resource": "file-write-data" },
    { "action": "allow", "resource": "file-write-create" },
    { "action": "allow", "resource": "file-write-unlink" },
    
    // network access
    { "action": "allow", "resource": "network-inbound" },
    { "action": "allow", "resource": "network-outbound" },
    { "action": "allow", "resource": "network-bind" },
    { "action": "allow", "resource": "network-connect" },
    
    // process execution
    { "action": "allow", "resource": "process-exec" },
    { "action": "allow", "resource": "process-fork" },
    { "action": "allow", "resource": "process-exec-interpreter" },
    { "action": "allow", "resource": "process-exec-script" },
    
    // system resources
    { "action": "allow", "resource": "system-socket" },
    { "action": "allow", "resource": "system-ioctl" },
    { "action": "allow", "resource": "system-privilege" },
    { "action": "allow", "resource": "system-mutex" },
    { "action": "allow", "resource": "system-shm" },
    
    // IPC (Inter-Process Communication)
    { "action": "allow", "resource": "ipc-posix-shm" },
    { "action": "allow", "resource": "ipc-posix-mutex" },
    { "action": "allow", "resource": "ipc-posix-sem" },
    { "action": "allow", "resource": "ipc-mach" },
    
    // Mach services
    { "action": "allow", "resource": "mach-lookup" },
    { "action": "allow", "resource": "mach-register" },
    { "action": "allow", "resource": "mach-send" },
    { "action": "allow", "resource": "mach-receive" },
    
    // User and group access
    { "action": "allow", "resource": "user-read" },
    { "action": "allow", "resource": "user-write" },
    { "action": "allow", "resource": "group-read" },
    { "action": "allow", "resource": "group-write" },
    
    // Device access
    { "action": "allow", "resource": "device-access" },
    { "action": "allow", "resource": "device-read" },
    { "action": "allow", "resource": "device-write" }



    found list of actions
    (define cache-directory (param "CACHE_DIR"))

    // define helper function
    (define (home-subpath home-relative-subpath)
    (subpath (string-append home-directory home-relative-subpath)))

    // use helper function
    (home-subpath security-path))


    // list of found resources
    file-issue-extension
    authorization-right-obtain 
    mach-lookup
    mach-bootstrap
    mach-register
    mach-task-name
    mach-priv-host-port
    mach-priv-host-port
    mach-per-user-lookup
    dynamic-code-generation
    distributed-notification-post
    necp-client-open
    system-necp-client-action
    device-camera
    device-microphone
    file-read*
    file-read-metadata
    file-read-data
    file-write*
    file-write-create
    file-write-data
    file-write-unlink
    file-write-xattr
    file-issue-extension
    file-read-metadata
    file-map-executable
    job-creation
    process-exec*
    process-fork
    process-info*
    process-info* (target self)
    distributed-notification-post
    process-info-pidinfo
    process-info-codesignature
    process-info-pidfdinfo
    process-info-pidfileportinfo
    process-info-setcontrol
    process-info-dirtycontrol
    process-info-rusage    
    user-preference-read
    user-preference-write
    signal
    pseudo-tty
    system-audit
    nvram*
    nvram-get
    system-socket
    network-bind
    network-inbound
    network-outbound
    lsopen
    ipc-posix-shm-read-data
    ipc-posix-shm-write-data
    ipc-posix-shm-write-create
    iokit-open
    iokit-open-user-client
    iokit-open-service
    iokit-async-external-method
    iokit-get-properties
    appleevent-send
    syscall-unix
    syscall-mach
    system-mac-syscall
    syscall-mig
    system-fcntl
    system-sched
    sysctl-read
    
    

    bob list of resources
    File System Access
file-issue-extension
file-read*
file-read-metadata
file-read-data
file-write*
file-write-create
file-write-data
file-write-unlink
file-write-xattr
file-map-executable
file-read-metadata
Authorization and System Preferences
authorization-right-obtain
user-preference-read
user-preference-write
nvram*
nvram-get
Mach Services
mach-lookup
mach-bootstrap
mach-register
mach-task-name
mach-priv-host-port
mach-per-user-lookup
Dynamic Code and Distributed Notifications
dynamic-code-generation
distributed-notification-post
Network and System Sockets
necp-client-open
system-necp-client-action
system-socket
network-bind
network-inbound
network-outbound
Device Access
device-camera
device-microphone
iokit-open
iokit-open-user-client
iokit-open-service
iokit-async-external-method
iokit-get-properties
Process and Job Management
job-creation
process-exec*
process-fork
process-info*
process-info* (target self)
process-info-pidinfo
process-info-codesignature
process-info-pidfdinfo
process-info-pidfileportinfo
process-info-setcontrol
process-info-dirtycontrol
process-info-rusage
System and Signal Management
signal
pseudo-tty
system-audit
lsopen
appleevent-send
syscall-unix
syscall-mach
system-mac-syscall
syscall-mig
system-fcntl
system-sched
sysctl-read
IPC and Shared Memory
ipc-posix-shm-read-data
ipc-posix-shm-write-data
ipc-posix-shm-write-create


    hack-different list of resources
    	"default",
	"appleevent-send",
	"authorization-right-obtain",
	"device*",
	"device-camera",
	"device-microphone",
	"distributed-notification-post",
	"file*",
	"file-chroot",
	"file-ioctl",
	"file-issue-extension",
	"file-map-executable",
	"file-mknod",
	"file-mount",
	"file-read*",
	"file-read-data",
	"file-read-metadata",
	"file-read-xattr",
	"file-revoke",
	"file-search",
	"file-unmount",
	"file-write*",
	"file-write-create",
	"file-write-data",
	"file-write-flags",
	"file-write-mode",
	"file-write-owner",
	"file-write-setugid",
	"file-write-times",
	"file-write-unlink",
	"file-write-xattr",
	"generic-issue-extension",
	"qtn-user",
	"qtn-download",
	"qtn-sandbox",
	"hid-control",
	"iokit*",
	"iokit-issue-extension",
	"iokit-open",
	"iokit-set-properties",
	"iokit-get-properties",
	"ipc*",
	"ipc-posix*",
	"ipc-posix-issue-extension",
	"ipc-posix-sem",
	"ipc-posix-shm*",
	"ipc-posix-shm-read*",
	"ipc-posix-shm-read-data",
	"ipc-posix-shm-read-metadata",
	"ipc-posix-shm-write*",
	"ipc-posix-shm-write-create",
	"ipc-posix-shm-write-data",
	"ipc-posix-shm-write-unlink",
	"ipc-sysv*",
	"ipc-sysv-msg",
	"ipc-sysv-sem",
	"ipc-sysv-shm",
	"job-creation",
	"load-unsigned-code",
	"lsopen",
	"mach*",
	"mach-bootstrap",
	"mach-issue-extension",
	"mach-lookup",
	"mach-per-user-lookup",
	"mach-priv*",
	"mach-priv-host-port",
	"mach-priv-task-port",
	"mach-register",
	"mach-task-name",
	"network*",
	"network-inbound",
	"network-bind",
	"network-outbound",
	"user-preference*",
	"user-preference-read",
	"user-preference-write",
	"process*",
	"process-exec*",
	"process-exec-interpreter",
	"process-fork",
	"process-info*",
	"process-info-listpids",
	"process-info-pidinfo",
	"process-info-pidfdinfo",
	"process-info-pidfileportinfo",
	"process-info-setcontrol",
	"process-info-dirtycontrol",
	"process-info-rusage",
	"pseudo-tty",
	"signal",
	"sysctl*",
	"sysctl-read",
	"sysctl-write",
	"system*",
	"system-acct",
	"system-audit",
	"system-chud",
	"system-debug",
	"system-fsctl",
	"system-info",
	"system-kext*",
	"system-kext-load",
	"system-kext-unload",
	"system-lcid",
	"system-mac-label",
	"system-nfssvc",
	"system-privilege",
	"system-reboot",
	"system-sched",
	"system-set-time",
	"system-socket",
	"system-suspend-resume",
	"system-swap",
	"system-write-bootstrap",

    with bob's exaplanations
    File System Access
* default: Sets the default action (allow or deny) for all unspecified actions.
* file*: Wildcard for file-related actions.
* file-chroot: Controls the ability to change the root directory of the current process (chroot).
* file-ioctl: Controls I/O control operations on files.
* file-issue-extension: Related to file extensions handling.
* file-map-executable: Controls mapping files as executable.
* file-mknod: Controls the ability to create device nodes.
* file-mount: Controls the ability to mount file systems.
* file-read*: Wildcard for all file read operations.
* file-read-data: Allows reading data from files.
* file-read-metadata: Allows reading file metadata.
* file-read-xattr: Allows reading extended attributes of files.
* file-revoke: Controls revoking access to files.
* file-search: Allows searching through directories.
* file-unmount: Controls the ability to unmount file systems.
* file-write*: Wildcard for all file write operations.
* file-write-create: Allows creating new files and directories.
* file-write-data: Allows writing data to files.
* file-write-flags: Controls changing file flags.
* file-write-mode: Allows changing file mode (permissions).
* file-write-owner: Allows changing file ownership.
* file-write-setugid: Controls setting user/group IDs on files.
* file-write-times: Allows changing file timestamps.
* file-write-unlink: Allows deleting files and directories.
* file-write-xattr: Allows writing extended attributes to files.
Authorization and Notifications
* appleevent-send: Controls sending Apple events.
* authorization-right-obtain: Controls obtaining authorization rights.
* distributed-notification-post: Controls posting distributed notifications.
Device Access
* device*: Wildcard for all device-related actions.
* device-camera: Allows access to the camera.
* device-microphone: Allows access to the microphone.
Generic and Specific Extensions
* generic-issue-extension: Related to generic extensions handling.
* qtn-user: Controls quarantine operations by the user.
* qtn-download: Controls quarantine operations during downloads.
* qtn-sandbox: Controls quarantine operations within the sandbox.
Human Interface Devices
* hid-control: Controls access to Human Interface Devices (HID).
IOKit Access
* iokit*: Wildcard for all IOKit-related actions.
* iokit-issue-extension: Related to IOKit extensions handling.
* iokit-open: Allows opening IOKit services.
* iokit-set-properties: Allows setting properties on IOKit objects.
* iokit-get-properties: Allows getting properties from IOKit objects.
Inter-Process Communication (IPC)
* ipc*: Wildcard for all IPC-related actions.
* ipc-posix*: Wildcard for all POSIX IPC actions.
* ipc-posix-issue-extension: Related to POSIX IPC extensions handling.
* ipc-posix-sem: Controls POSIX semaphores.
* ipc-posix-shm*: Wildcard for all POSIX shared memory actions.
* ipc-posix-shm-read*: Wildcard for reading POSIX shared memory.
* ipc-posix-shm-read-data: Allows reading data from POSIX shared memory.
* ipc-posix-shm-read-metadata: Allows reading metadata from POSIX shared memory.
* ipc-posix-shm-write*: Wildcard for writing POSIX shared memory.
* ipc-posix-shm-write-create: Allows creating POSIX shared memory.
* ipc-posix-shm-write-data: Allows writing data to POSIX shared memory.
* ipc-posix-shm-write-unlink: Allows unlinking POSIX shared memory.
* ipc-sysv*: Wildcard for all System V IPC actions.
* ipc-sysv-msg: Controls System V message queues.
* ipc-sysv-sem: Controls System V semaphores.
* ipc-sysv-shm: Controls System V shared memory.
Job and Process Management
* job-creation: Controls creating new jobs.
* process*: Wildcard for all process-related actions.
* process-exec*: Wildcard for all process execution actions.
* process-exec-interpreter: Controls executing interpreters.
* process-fork: Allows forking new processes.
* process-info*: Wildcard for all process information actions.
* process-info-listpids: Allows listing process IDs.
* process-info-pidinfo: Allows getting information about processes by PID.
* process-info-pidfdinfo: Allows getting file descriptor information by PID.
* process-info-pidfileportinfo: Allows getting file port information by PID.
* process-info-setcontrol: Controls setting process controls.
* process-info-dirtycontrol: Controls dirty process information.
* process-info-rusage: Allows getting resource usage information.
Network Access
* network*: Wildcard for all network-related actions.
* network-inbound: Allows inbound network connections.
* network-bind: Allows binding to network ports.
* network-outbound: Allows outbound network connections.
User Preferences and System Settings
* user-preference*: Wildcard for all user preference actions.
* user-preference-read: Allows reading user preferences.
* user-preference-write: Allows writing user preferences.
* sysctl*: Wildcard for all sysctl actions.
* sysctl-read: Allows reading sysctl parameters.
* sysctl-write: Allows writing sysctl parameters.
System-Level Controls
* system*: Wildcard for all system-related actions.
* system-acct: Controls access to system accounting.
* system-audit: Controls access to system auditing.
* system-chud: Controls access to CHUD (Computer Hardware Understanding Developer) tools.
* system-debug: Allows debugging system processes.
* system-fsctl: Controls file system control operations.
* system-info: Allows accessing system information.
* system-kext*: Wildcard for all kernel extension actions.
* system-kext-load: Allows loading kernel extensions.
* system-kext-unload: Allows unloading kernel extensions.
* system-lcid: Controls access to LCID (Locale ID) settings.
* system-mac-label: Controls MAC (Mandatory Access Control) labels.
* system-nfssvc: Controls access to NFS services.
* system-privilege: Controls system privilege operations.
* system-reboot: Allows rebooting the system.
* system-sched: Controls system scheduling.
* system-set-time: Allows setting the system time.
* system-socket: Allows using system sockets.
* system-suspend-resume: Controls system suspend and resume.
* system-swap: Controls system swapping.
* system-write-bootstrap: Controls writing to the system bootstrap.



    Bob's list of relevant resources
    File System Access
        file-read*: Allows reading files.
        file-write*: Allows writing to files.
        file-read-data: Allows reading data from files.
        file-read-metadata: Allows reading file metadata.
        file-write-data: Allows writing data to files.
        file-write-create: Allows creating files and directories.
        file-write-unlink: Allows deleting files and directories.
    Network Access
        network-inbound: Allows inbound network connections.
        network-outbound: Allows outbound network connections.
        network-bind: Allows binding to network ports.
    Process and Job Management
        process-exec*: Allows executing new processes.
        process-fork: Allows forking processes.
        process-info*: Allows accessing process information.
    System and Signal Management
        system-socket: Allows using system sockets.
        system-ioctl: Allows performing I/O control operations.
        system-privilege: Allows using system privileges.
    IPC and Shared Memory
        ipc-posix-shm-read-data: Allows reading POSIX shared memory data.
        ipc-posix-shm-write-data: Allows writing POSIX shared memory data.
        ipc-posix-shm-write-create: Allows creating POSIX shared memory.
    Device Access
        device-camera: Allows access to the camera.
        device-microphone: Allows access to the microphone.
        device-access: Allows general device access.
        device-read: Allows reading from devices.
        device-write: Allows writing to devices.


 * 
 */
