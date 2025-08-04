---
title: "Mounting shared folders on a virtual machine"
date: 2025-8-4
categories: [sundries]
tags: [something]
pin: false
math: true
mermaid: true
---

## The problem: `/mnt/hgfs` does not show shared folders

My newly installed Ubuntu-22.04 on VMware does not show shared folders in `/mnt/hgfs` directory, though the target folder `Desktop` has been set, so the current situation is:

- Host: Windows 11

- The `open-vm-tools` and `open-vm-tools-desktop` (latest) have been installed

- Neither file nor directory exists (only `.` and `..`) inside `/mnt/hgfs` (the mount point)

- `.host:/Desktop` has been mounted to `/mnt/hgfs` using `vmhgfs-fuse`:

  ```bash
  $ df -h
  Filesystem      Size  Used Avail Use% Mounted on
  vmhgfs-fuse 952G 428G 525G 45% /mnt/hgfs
  ```


## Resolution

### Try to uninstall the existing mounts and remount all shared folders:

```bash
$ sudo fusermount -u /mnt/hgfs
```

There shouldn't be any output from `df -h | grep hgfs`

```bash
$ sudo mount -t fuse.vmhgfs-fuse .host:/ /mnt/hgfs -o allow_other -o uid=1000 -o gid=1000 # use command `id` to adjust the uid and gid
```
```bash
$ sudo ls /mnt/hgfs # do as super user mode since there may have some permission issues
Desktop
```

Refresh the shared folder setting on the host side if it still doesn't work.

### Setting up auto-mount if needed

```bash
$ echo ".host:/ /mnt/hgfs fuse.vmhgfs-fuse defaults,allow_other,uid=1000,gid=1000 0 0" | sudo tee -a /etc/fstab # -a to append a new line, same as `echo ' ... ' >> /etc/fstab`
$ sudo reboot
```


## References

- [https://knowledge.broadcom.com/external/article?legacyId=60262](https://knowledge.broadcom.com/external/article?legacyId=60262)
- [https://askubuntu.com/questions/29284/how-do-i-mount-shared-folders-in-ubuntu-using-vmware-tools](https://askubuntu.com/questions/29284/how-do-i-mount-shared-folders-in-ubuntu-using-vmware-tools)
