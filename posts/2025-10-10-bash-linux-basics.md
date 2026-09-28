---
title: "关于Bash和Linux"
date: 2025-10-10
description: 出题顺手写的文档, 帮助新生了解一些计算机基础
categories: [learn]
tags: [bash, linux]
pin: false
math: true
mermaid: true
---

## [Bourne](https://www.youtube.com/watch?v=dc0hg7w8rbs) Again SHell

来自[GNU Project](https://www.gnu.org/gnu/about-gnu.html), 是 Bourne shell (sh) 加强版, 属于[Shell](https://en.wikipedia.org/wiki/Shell_(computing))大类, *本质上是个程序*, 运行在[GNU操作系统](https://www.gnu.org/gnu/gnu.html)上, 作为用户与操作系统用户空间程序交互的接口.

说这些可能会让你一头雾水. 所以, 先用再说. 如果你是Windows系统, 需要使用[WSL](https://en.wikipedia.org/wiki/Windows_Subsystem_for_Linux)[^2]安装使用Bash的GNU/Linux发行版 (推荐[Ubuntu](https://www.google.com/search?q=Ubuntu&oq=Ubuntu&gs_lcrp=EgZjaHJvbWUyEQgAEEUYORhDGLEDGIAEGIoFMgwIARAjGCcYgAQYigUyDAgCECMYJxiABBiKBTIMCAMQABhDGIAEGIoFMgwIBBAAGEMYgAQYigUyBggFEEUYPDIGCAYQRRg9MgYIBxBFGDzSAQc5MzJqMGo5qAIAsAIA&sourceid=chrome&ie=UTF-8)或[Debian](https://www.google.com/search?q=Debian&sca_esv=9b12a356d0a089c1&sxsrf=AE3TifPPcrl0meP_ggqszbTNZ-ve4H2z6A%3A1754742423841&ei=lz6XaNuQM_SaseMP3raf0AU&ved=0ahUKEwibuOH23P2OAxV0TWwGHV7bB1oQ4dUDCBI&uact=5&oq=Debian&gs_lp=Egxnd3Mtd2l6LXNlcnAiBkRlYmlhbjIKECMYgAQYJxiKBTIEECMYJzIQEAAYgAQYsQMYQxiDARiKBTIKEAAYgAQYQxiKBTIKEAAYgAQYQxiKBTIKEAAYgAQYQxiKBTIKEAAYgAQYQxiKBTIKEAAYgAQYQxiKBTIKEAAYgAQYQxiKBTIKEAAYgAQYQxiKBUjET1DTRViqTnADeAGQAQCYAY8BoAHABqoBAzAuNrgBA8gBAPgBAZgCCaAC5gaoAhTCAgcQIxiwAxgnwgIKEAAYsAMY1gQYR8ICBxAjGCcY6gLCAhMQABiABBhDGLQCGIoFGOoC2AEBwgIOEC4YgAQYsQMY0QMYxwHCAgsQLhiABBjRAxjHAcICExAuGIAEGLEDGNEDGEMYxwEYigWYAwbxBdNznGHXYTbLiAYBkAYKugYGCAEQARgBkgcDMy42oAeuN7IHAzAuNrgH2AbCBwUwLjIuN8gHIA&sclient=gws-wiz-serp)等). 过程不难, 可以参照[官方文档](https://learn.microsoft.com/en-us/windows/wsl/install)操作[^1]; 如果你是GNU/Linux系统, 想必你应该熟悉一些Bash的基本命令了. 首先在[这里](https://199604.com/dev/docs/bash.html)看看bash都有哪些指令. 另外, 在mini赛题中会出现ELF格式的文件, 需要在GNU/Linux环境 (原生, WSL, 容器或虚拟机) 上进行运行和调试.

## 了解Bash

- 如果想要系统学习Bash以及相关基础, 推荐: [The Missing Semester of Your CS Education](https://missing.csail.mit.edu/)

- 或者说直接下手开干, *大语言模型* 是不错的老师

- 当然Bash只是Shell家族中最广泛使用的一员, 还有一些和它平起平坐的Shell: **[Zsh](https://ohmyz.sh/)**, **[nushell](https://github.com/nushell/nushell)**, **KornShell**, **Tcsh**, **Fish** 等等.

## 一些问题

1. Terminal / Shell / CLI / Bash 都是一个东西吗?
2. Linux, GNU/Linux, GNU Project, GNU Operating System 都是一个东西吗?
3. 编译C的编译器`gcc`, `g++`, 全称是什么? 属于什么?
4. Unix和Unix-like的关系是什么?

***Terminal / Shell / CLI / Bash 都是一个东西吗？***    当然———不是, 他们相关, 但不属于一个层级, Terminal (**终端程序**, 是个程序[^7], 负责显示和输入) 提供一个界面让你访问, Shell (**命令解释器**) 是一个抽象的集合, 具体包括Bash等等, 他们既可以让你在终端中敲命令与操作系统交互[^6], 还能写成脚本批量执行 (Bash既是交互式命令解释器, 也是脚本语言[^4], 暂且把它想成Python[^5]); [CLI](https://en.wikipedia.org/wiki/Command-line_interface#:~:text=a%20means%20of%20interacting%20with%20software%20via%20commands%20%E2%80%93%20each%20formatted%20as%20a%20line%20of%20text) (**命令行界面**) 更抽象, 是一种交互方式. Shell及其他的CLI程序 (e.g., `git`, `curl` 等等) 是CLI的具体化, 都是使用line-by-line的命令行方式与软件本身交互.

***Linux, GNU/Linux, GNU Project, GNU Operating System 都是一个东西吗?***    也不是, **Linux**严格来讲是Linux内核 (组成操作系统的核心); **GNU/Linux** = Linux 内核[^3] + GNU 用户空间的工具们 (包括Bash); **GNU Project**顾名思义是个项目, 由 Richard Stallman 发起, 感兴趣可以看看[官方的介绍](https://www.gnu.org/gnu/thegnuproject.en.html); **GNU Operating System** = GNU Hurd内核 + GNU 用户空间的工具们 (包括Bash), 虽然单说Linux并不是完整的操作系统, 但随着人们的误解和这么说的人越来越多, Linux也可以指代 GNU/Linux ,感兴趣可以看看[GNU创始人的澄清](https://www.gnu.org/gnu/linux-and-gnu.html).

***编译C的编译器`gcc`, `g++`, 全称是什么? 属于什么?***    **gcc (原本只是GNU C Compiler, 后来是GNU Compiler Collection)**, 它不仅可以编译C, 还可以编译C++, Objective-C, Fortran, Ada, Go等挺多语言; **g++ (GNU C++ Compiler, 是GCC 中的 C++ 前端)** g++（GNU C++ Compiler）是 GCC 的 C++ 前端/驱动程序。就命令 `g++` 而言，它调用 GCC 的 C++ 前端，默认按 C++ 语法处理源文件（包括 .c，除非用 -x c 指定为 C），并默认链接 C++ 标准库。GCC 属于 GNU Project 的一部分。

省流版丢个表格能清晰点, 当我们使用`gcc main.* -o main`时:

| 扩展名                     | 默认语言模式                  |
| :------------------------- | :---------------------------- |
| `.c`                       | C (但用 `g++` 编译会当作 C++) |
| `.cc` `.cpp` `.cxx` `.c++` | C++                           |
| `.C`（大写）               | C++                           |
| `.m`                       | Objective-C                   |
| `.mm`                      | Objective-C++                 |
| ...                        | ...                           |

所以`.cpp` 用`g++`, `.c`用`gcc`.

***Unix和Unix-like的关系是什么?***    Unix-like系统现在包含正统的Unix系统,, 一个直观的树形图:

```
Unix-like
 ├── Certified Unix
 │    ├── IBM AIX
 │    ├── HP-UX
 │    ├── Oracle Solaris
 │    └── macOS
 └── Non-certified but Unix-like
      ├── GNU/Linux
      ├── FreeBSD / OpenBSD / NetBSD
      ├── illumos
      └── Minix
      └── ...
```

展示了二者的关系. 图表中的第二类Unix-like系统 (无认证) 的描述: 具有Unix特性和接口的系统, 目录和文件系统的层级结构类似Unix, 遵循POSIX的操作系统.

## 最后

- 零零零基础, 不用担心很多东西不懂, 从 LLMs, Google, Wikipedia, Github, 甚至Youtube, Bilibili 等等网站能学到的东西数不胜数, 关键要有耐心, 推荐先浏览[NJU-PA](https://nju-projectn.github.io/ics-pa-gitbook/)的Introduction部分
- 玩的开心
- 本文如有任何问题, 欢迎大佬指正!

---

[^1]: 也可用 Git for Windows 自带的 Git Bash, Cygwin 或 MSYS2 等, 但还不急, 这些你以后可能会遇到
[^2]: 推荐 WSL2, 最接近真实 Linux. 注意换行符 CRLF/LF 与路径差异. 可以在Windows Terminal中设置WSL路径转换
[^3]: Note: Project 是组织与计划; Operating System 指 Hurd 内核 + 用户空间; 多数人日常用的是 Linux 内核而非 Hurd. 
[^4]: Windows 用 CRLF (\r\n), Unix/WSL/macOS 用 LF (\n). Bash 脚本必须是 LF; CRLF 会报错哦
[^5]: 实际上不准确, 我们用Bash编排流程 (它擅长使用CLI工具制作流程); 用 Python/Go 写程序; 性能交给 C/C++/Rust. 

[^6]: 当然不止终端交互 ([ref: wikipedia](https://en.wikipedia.org/wiki/Shell_(computing)#:~:text=although%20some%20graphical%20user%20interface%20(gui)%20programs%20are%20arguably%20classified%20as%20shells%20too)), 比如 Windows 的 `explorer.exe`. 右键菜单, 文件关联, 桌面等都属于它的职能, 而他是个Windows Shell (GUI Shell). 简而言之, 如果它主要启动/管理其他程序和环境, 那就是shell, 否则不是.
[^7]: 这里指[Terminal Emulator](https://en.wikipedia.org/wiki/Terminal_emulator), 并不是真正的[Terminal](https://en.wikipedia.org/wiki/Computer_terminal), 感兴趣可以看看[这个reddit的讨论](https://www.reddit.com/r/learnprogramming/comments/r4or28/can_someone_please_explain_what_a_bash_and_shell/#:~:text=a%20terminal%20emulator%20is%20a%20software%20program%20that%20emulates%20a%20physical%20terminal%2C%20doing%20the%20same%20job%20as%20a%20terminal%20while%20running%20on%20an%20actual%20computer)
