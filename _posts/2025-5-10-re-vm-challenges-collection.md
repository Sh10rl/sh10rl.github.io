---
title: "Re VM Challenges Collection"
date: 2025-5-10
categories: [ctf]
tags: [vm, go, jottings]
pin: false
math: true
mermaid: true
---

## Foreword

After tackling ~~some~~ virtual machine reverse engineering challenges ([ACTF](https://github.com/team-s2/ACTF-2025/tree/main) - [miniLCTF](https://github.com/XDSEC/miniLCTF_2025/)), it's time to write a rundown of my approaches, so here's this post.

## [[NCTF 2024](https://github.com/X1cT34m/NCTF2024/tree/main)] [gogo](https://pcnc027ut287.feishu.cn/wiki/Sslpw98OziXPWmk5CfXcgUGVnhh#share-ObLUdKTLxoId8TxoNQScZyYhn6f)

A Turing-complete Virtual Machine (VM) implementing a TEA algorithm, which is closer to a Finite State Machine after regarding `STRI` and `LDRI` as input.

| **Instruction**         | **Operands** | **Operand 1 (Byte `a10`)** | **Operand 2 (Byte `a11`)**         | **Operand 3 (Byte `a12`)** |
| ----------------------- | ------------ | -------------------------- | ---------------------------------- | -------------------------- |
| **ADD/SUB/MUL/XOR/AND** | 3            | Rd (reg index)             | Rn (reg index)                     | Rm (reg index)             |
| **LSL/LSR**             | 3            | Rd (reg index)             | Rn (value reg)                     | Rm (shift amt reg)         |
| **MOV**                 | 2            | Rd (reg index)             | Immediate val (WORD little endian) |                            |
| **STRI/LDRI**           | 2            | Rd (reg index)             | Must be `0x00`                     | Immediate val (addr)       |
| **LDR/STR**             | 2            | Rd (reg index)             | Rn (addr)                          | Must be `0x00`             |

```asm
; --- VM1 Disassembly from DumpedByteCodes.bin ---
; Offset           Bytes        Instruction
0x00000000:  2A 00 37 9E  MOV   R0, #0x9e37
0x00000004:  2A 01 B9 79  MOV   R1, #0x79b9
0x0000000C:  2A 02 10 00  MOV   R2, #0x0010
0x00000010:  71 03 00 02  LSL   R3, R0, R2
0x0000001C:  41 01 01 03  ADD   R1, R1, R3
0x00000020:  16 01 00 1C  STRI  R1, [#0x1c] ; 0x9e3779b9
0x00000024:  2A 00 00 00  MOV   R0, #0x0000
0x00000034:  16 00 00 18  STRI  R0, [#0x18]
0x00000040:  2A 0E 00 00  MOV   R14, #0x0000
0x00000044:  12 02 00 04  LDRI  R2, [#0x04] ; y
0x0000004C:  12 03 00 10  LDRI  R3, [#0x10] ; z
0x00000050:  2A 00 02 00  MOV   R0, #0x0002
0x00000060:  2A 0F 05 00  MOV   R15, #0x0005
0x00000064:  71 04 02 00  LSL   R4, R2, R0  ; y << 2
0x0000006C:  73 05 03 0F  LSR   R5, R3, R15 ; z >> 5
0x00000070:  7A 06 04 05  XOR   R6, R4, R5  ; (z >> 5) ^ (y << 2)
0x00000080:  2A 00 03 00  MOV   R0, #0x0003
0x00000084:  2A 0F 04 00  MOV   R15, #0x0004
0x00000088:  73 04 02 00  LSR   R4, R2, R0  ; y >> 3
0x00000098:  71 05 03 0F  LSL   R5, R3, R15 ; z << 4
0x0000009C:  7A 07 04 05  XOR   R7, R4, R5  ; (y >> 3) ^ (z << 4)
0x000000A0:  41 08 06 07  ADD   R8, R6, R7  ; ((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4))
0x000000A8:  2A 04 8C A7  MOV   R4, #0xa78c
0x000000AC:  2A 05 4F 0B  MOV   R5, #0x0b4f
0x000000BC:  2A 0F 10 00  MOV   R15, #0x0010
0x000000C4:  71 06 04 0F  LSL   R6, R4, R15
0x000000C8:  41 05 05 06  ADD   R5, R5, R6
0x000000CC:  16 05 00 28  STRI  R5, [#0x28] ; 0xa78c0b4f
0x000000D8:  2A 0F 02 00  MOV   R15, #0x0002
0x000000DC:  73 09 01 0F  LSR   R9, R1, R15 ; sum >> 2
0x000000E8:  7B 0D 09 00  AND   R13, R9, R0 ; (sum >> 2) & 3
0x000000EC:  7A 04 0D 0E  XOR   R4, R13, R14; p ^ ( (sum >> 2) & 3 )
0x000000F4:  7B 04 04 00  AND   R4, R4, R0  ; p ^ ( (sum >> 2) & 3 ) & 3
0x00000100:  2A 0C 04 00  MOV   R12, #0x0004
0x00000104:  47 04 04 0C  MUL   R4, R4, R12 ; idx * 4
0x00000108:  2A 0F 20 00  MOV   R15, #0x0020
0x00000110:  41 0A 04 0F  ADD   R10, R4, R15; (idx * 4) + 0x20
0x0000011C:  11 04 0A 00  LDR   R4, [R10]   ; key[p ^ ( (sum >> 2) & 3 ) & 3]
0x00000120:  7A 06 01 02  XOR   R6, R1, R2  ; sum ^ y
0x00000128:  7A 07 03 04  XOR   R7, R3, R4  ; z ^ key[p]
0x0000012C:  41 09 06 07  ADD   R9, R6, R7  ; (sum ^ y) + (z ^ key[p ^ e & 3])
0x0000013C:  7A 0A 08 09  XOR   R10, R8, R9 ; ((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4)) ^ ((sum ^ y) + (key[(p & 3) ^ e] ^ z))
0x00000144:  2A 04 63 6E  MOV   R4, #0x6e63
0x00000148:  2A 05 66 74  MOV   R5, #0x7466
0x0000014C:  2A 0F 10 00  MOV   R15, #0x0010
0x0000015C:  71 06 04 0F  LSL   R6, R4, R15
0x00000164:  41 05 05 06  ADD   R5, R5, R6
0x00000168:  16 05 00 20  STRI  R5, [#0x20] ; 0x6e637466
0x00000170:  12 0B 00 00  LDRI  R11, [#0x00]
0x00000180:  41 0C 0A 0B  ADD   R12, R10, R11
0x00000188:  16 0C 00 00  STRI  R12, [#0x00]
0x00000198:  2A 00 01 00  MOV   R0, #0x0001
0x0000019C:  41 0E 0E 00  ADD   R14, R14, R0
0x000001AC:  2A 04 2E 06  MOV   R4, #0x062e
0x000001B0:  2A 05 ED F0  MOV   R5, #0xf0ed
0x000001B8:  2A 0F 10 00  MOV   R15, #0x0010
0x000001C4:  71 06 04 0F  LSL   R6, R4, R15
0x000001C8:  41 05 05 06  ADD   R5, R5, R6
0x000001D8:  16 05 00 24  STRI  R5, [#0x24] ; 0x062ef0ed
0x000001DC:  12 02 00 08  LDRI  R2, [#0x08] ; y
0x000001E0:  12 03 00 00  LDRI  R3, [#0x00] ; z
0x000001F0:  2A 00 02 00  MOV   R0, #0x0002 ;
0x000001F4:  2A 0F 05 00  MOV   R15, #0x0005;
0x000001F8:  71 04 02 00  LSL   R4, R2, R0  ; << 2
0x00000208:  73 05 03 0F  LSR   R5, R3, R15 ; >> 5
0x00000218:  7A 06 04 05  XOR   R6, R4, R5
0x0000021C:  2A 00 03 00  MOV   R0, #0x0003 ;
0x00000220:  2A 0F 04 00  MOV   R15, #0x0004;
0x0000022C:  73 04 02 00  LSR   R4, R2, R0
0x00000230:  71 05 03 0F  LSL   R5, R3, R15
0x00000234:  7A 07 04 05  XOR   R7, R4, R5
0x00000244:  41 08 06 07  ADD   R8, R6, R7
0x00000248:  2A 04 30 32  MOV   R4, #0x3230
0x00000250:  2A 05 34 32  MOV   R5, #0x3234
0x00000254:  2A 0F 10 00  MOV   R15, #0x0010
0x00000258:  71 06 04 0F  LSL   R6, R4, R15
0x00000264:  41 05 05 06  ADD   R5, R5, R6
0x00000268:  16 05 00 2C  STRI  R5, [#0x2c] ; 0x32303234
.  .  .

```

## [[NCTF 2023](https://github.com/X1cT34m/NCTF2023)] ezVM

This VM also implements a Turing-complete VM. Yet, its behavior is closer to a [pushdown automaton](https://en.wikipedia.org/wiki/Pushdown_automaton) (`PDA` = `FSM` + `STACK`) which can leak side channel info due to single-byte verification.

### Acquire Side-channel Info

Using following script to count how many times the target instruction is executed.

```python
# -*- coding: utf-8 -*-
import idaapi
import idc
import ida_kernwin
import ida_dbg

# --- Global Variables ---
# Stores the count for the single address being tracked during the CURRENT run
execution_counts = {}
# Stores the history of counts from PREVIOUS runs for the tracked address
run_history = {}
# Stores the address we are currently tracking
g_target_ea = idaapi.BADADDR
# Stores the instance of our debugger hook
g_debugger_hook = None

# --- Debugger Hook Class ---
class ExecutionCounterHook(ida_dbg.DBG_Hooks):
    """
    Debugger hook to detect process termination, record counts, and reset for the next run.
    """
    def dbg_process_exit(self, pid, tid, ea, code):
        """
        Called when the debugged process terminates.
        Records the count for the finished run and resets the counter.
        """
        print(f"[Debug Event] Process exited (PID: {pid}, Code: {code})")
        self._record_and_reset_count()
        return 0 # Important: Hooks should generally return 0

    def _record_and_reset_count(self):
        """
        Helper to record the count for the completed run, print history,
        and reset the counter for the next run.
        """
        global execution_counts, run_history, g_target_ea

        if g_target_ea != idaapi.BADADDR:
            current_count = execution_counts.get(g_target_ea, 0)

            # Record the count for this run in history
            history_list = run_history.setdefault(g_target_ea, [])
            history_list.append(current_count)

            print(f"--- Execution Count Report ({g_target_ea:#x}) ---")
            print(f"  Current Run: {current_count} times")
            print(f"  History: {history_list}")
            print(f"-----------------------------")

            # Reset count ONLY for the next run
            execution_counts[g_target_ea] = 0
            print(f"[INFO] Count for address {g_target_ea:#x} has been reset to 0, ready for the next run.")

        else:
            print("[INFO] No valid address is currently being tracked.")

# --- Core Functions ---
def set_counting_bpt(ea):
    """
    Sets a trace breakpoint at the specified address 'ea' to count
    the number of times this instruction is executed.
    The breakpoint will not suspend the program; it only executes the counting code.

    Args:
        ea (int): The effective address (EA) of the target instruction.

    Returns:
        bool: True if setting the breakpoint was successful, False otherwise.
    """
    global execution_counts

    # 1. Check if the address is valid
    if not idaapi.is_mapped(ea):
        print(f"[ERROR] Address {ea:#x} is invalid or not mapped.")
        return False

    # 2. Prepare Python condition code (return 0 to solve SWIG issues)
    #    Use f-string to embed the address, ensuring dictionary key is an integer
    python_condition = f"""
global execution_counts
addr = {ea}
execution_counts[addr] = execution_counts.get(addr, 0) + 1
# print(f"Hit count at {{addr:#x}}: {{execution_counts[addr]}}") # Uncomment for debugging
return 0
"""
    # Clean up newlines and indentation
    python_condition = "\n".join([line.strip() for line in python_condition.strip().splitlines()])

    # 3. Add or get breakpoint
    bpt = idaapi.bpt_t()
    # First, try to delete an old breakpoint at the same address (if any) to avoid configuration conflicts
    idaapi.del_bpt(ea)
    if not idaapi.add_bpt(ea, 0, idaapi.BPT_SOFT):
        print(f"[ERROR] Failed to add breakpoint at address {ea:#x}.")
        return False
    else:
        # Must re-fetch breakpoint info to modify it
        if not idaapi.get_bpt(ea, bpt):
            print(f"[ERROR] Failed to get breakpoint info at address {ea:#x} after adding it.")
            # Clean up failed breakpoint addition
            idaapi.del_bpt(ea)
            return False

    # 4. Configure breakpoint properties
    bpt.elang = 'Python'
    bpt.condition = python_condition
    bpt.flags |= idaapi.BPT_ENABLED
    bpt.flags &= ~idaapi.BPT_BRK   # Crucial: Do not suspend
    bpt.flags |= idaapi.BPT_TRACE  # Explicitly marking as trace breakpoint might help in some IDA versions

    # 5. Update breakpoint
    if not idaapi.update_bpt(bpt):
        print(f"[ERROR] Failed to update breakpoint at address {ea:#x}.")
        # Clean up failed breakpoint update
        idaapi.del_bpt(ea)
        return False

    # 6. Initialize count for the current run
    execution_counts[ea] = 0

    print(f"[SUCCESS] Execution counting tracepoint set at address {ea:#x}.")
    return True

def reset_all():
    """
    Complete reset: clears counts, history, removes breakpoints, and unhooks the debugger hook.
    """
    global execution_counts, run_history, g_target_ea, g_debugger_hook

    print("[ACTION] Performing a full reset...")

    # Remove breakpoint
    if g_target_ea != idaapi.BADADDR:
        print(f"  - Removing breakpoint at address {g_target_ea:#x}...")
        if idaapi.del_bpt(g_target_ea):
            print(f"  - Breakpoint removed.")
        else:
            print(f"[WARNING] Failed to remove breakpoint at address {g_target_ea:#x} (it might have been manually removed).")
    else:
        print("  - No breakpoint to remove (target address not set).")

    # Clear counts and history
    execution_counts.clear()
    run_history.clear()
    print(f"  - Execution counts and history cleared.")

    # Unhook and clear hook instance
    if g_debugger_hook:
        print("  - Unhooking debugger hook...")
        try:
            g_debugger_hook.unhook()
            print("  - Debugger hook unhooked.")
        except Exception as e:
            print(f"[ERROR] Error unhooking debugger hook: {e}")
        finally:
            g_debugger_hook = None # Clear reference
    else:
        print("  - No hook to unhook (not active).")

    # Reset target address
    g_target_ea = idaapi.BADADDR
    print("[DONE] All tracking states have been reset.")

# --- Main Execution Logic ---
def run_execution_counter_script():
    """
    Main function: gets an address, sets up the breakpoint and hook (if not already set).
    """
    global g_target_ea, g_debugger_hook, execution_counts, run_history

    # 0. Check if an address is already being tracked
    if g_target_ea != idaapi.BADADDR:
        print(f"[INFO] Currently tracking address {g_target_ea:#x}.")
        print(f"  - Current run count: {execution_counts.get(g_target_ea, 0)}")
        print(f"  - History: {run_history.get(g_target_ea, [])}")
        choice = ida_kernwin.ask_yn(1, f"Currently tracking {g_target_ea:#x}.\nDo you want to fully reset and choose a new address?\n(Select 'No' to continue tracking the current address)")
        if choice == 1: # Yes
            reset_all() # Full reset
        else:
            print("[Action Canceled] Continuing to track the current address. To stop, call reset_all().")
            return

    # --- If execution reaches here, there's no active tracking or user chose to reset ---

    # 1. Pop up window to request address
    prompt_msg = "Please enter the instruction address to count executions for (e.g., 0x401000):"
    default_addr = idc.here() # Default to current cursor address
    input_ea = ida_kernwin.ask_addr(default_addr, prompt_msg)

    # 2. Validate user input
    if input_ea is None or input_ea == idaapi.BADADDR:
        print("[INFO] User canceled or did not enter a valid address. Script terminated.")
        return

    if not idaapi.is_mapped(input_ea):
        print(f"[ERROR] The entered address {input_ea:#x} is invalid or not mapped. Script terminated.")
        return

    # Record the new target address
    g_target_ea = input_ea
    print(f"[INFO] New target address set to: {g_target_ea:#x}")

    # Clear any existing old counts and history for this address (just in case)
    execution_counts.pop(g_target_ea, None)
    run_history.pop(g_target_ea, None)
    # Initialize count and history containers for the new address
    execution_counts[g_target_ea] = 0
    run_history[g_target_ea] = []

    # 3. Set counting breakpoint
    if not set_counting_bpt(g_target_ea):
        print("[ERROR] Failed to set breakpoint. Script terminated.")
        g_target_ea = idaapi.BADADDR # Reset target address
        return

    # 4. Create and register debugger hook (only on first setup)
    if g_debugger_hook is None:
        try:
            print("[ACTION] Registering debugger hook to listen for process exit...")
            g_debugger_hook = ExecutionCounterHook()
            g_debugger_hook.hook()
            print("[SUCCESS] Debugger hook registered successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to register debugger hook: {e}")
            # Attempt to clean up breakpoint
            idaapi.del_bpt(g_target_ea)
            g_target_ea = idaapi.BADADDR
            execution_counts.clear()
            run_history.clear()
            g_debugger_hook = None
            return
    else:
        print("[INFO] Debugger hook is already active.")

    print("-" * 40)
    print(f"Script setup complete. Tracking address {g_target_ea:#x}.")
    print("Please start the debugger (F9) and run the target program.")
    print("After the program finishes normally, the execution count for this address will be automatically printed and recorded.")
    print("You can run the program multiple times to accumulate history.")
    print("Use the reset_all() function to completely stop and clear all data.")
    print("-" * 40)

# --- Script Entry Point ---
if __name__ == "__main__":
    # Note: reset_all() is not called here anymore to preserve state when reloading the script.
    # If a completely clean start is needed, call reset_all() manually from the IDA Python command line.
    # reset_all() # Uncomment to force reset every time the script runs

    # Run main logic
    run_execution_counter_script()

# --- Helper Functions (can be called from IDA Python command line) ---
# reset_all()  # For manual full reset

```

Set a breakpoint using the script above:

![](/assets/img/2025-5-10-re-vm-challenges-collection/breakpoint.png)

```
Sample inputs:
input1: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
input2: "faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
input3: "flaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
Execution counts:
[147, 208, 326]

```

Obviously, single-byte verification with flag structure: `flag{ ... }`.

The script below (Python + Frida) implements side-channel brute-force:

```python
# PyScript.py
# -*- coding: UTF-8 -*-
import subprocess
import frida
import sys
import os # Added for checking hook file existence

# --- Configuration Constants ---
TARGET_EXE = "ezVm.exe"
HOOK_SCRIPT_FILE = "hook.js"
# Flag length including "flag{" and "}"
# Original script uses range(len(flag), 44) and ljust(43,"A")+"}"
# This implies total length is 44, content length is 44-len("flag{}") = 38
# Padding length is 43 (index 0 to 42)
FLAG_TOTAL_LENGTH = 44
FLAG_CONTENT_PAD_LENGTH = 43 # Length used for ljust padding
FLAG_KNOWN_PREFIX = "flag{O1SC_VM"
PADDING_CHAR = "a"
# Character set for bruteforce, starting with '`' for calibration
PRINTABLE_CHARS = r"`!\"#$%&'()*+,-./:;<=>?@[]^_{|}~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
# Initial comparison value (last value assigned in original script)
INITIAL_NUMBER = 103833

# --- Global State for Frida Interaction ---
# 'number' stores the score of the best known prefix
# 'new_number' stores the score of the current attempt
number = INITIAL_NUMBER
new_number = 0

# --- Frida Callback Function ---
def on_message(message, data):
    """Callback function to handle messages from the Frida script."""
    global new_number
    if message['type'] == 'send':
        payload = message['payload']
        # print(f"[*] Frida Message Payload: {payload}", type(payload)) # Optional: more detailed debug
        try:
            # Assume payload is the number we need for comparison
            new_number = int(payload)
        except (ValueError, TypeError) as e:
            print(f"[!] Error parsing Frida payload: {payload} - {e}")
            # Decide how to handle parse errors, maybe reset new_number?
            new_number = -1 # Or some other indicator of failure
    elif message['type'] == 'error':
        print(f"[!] Frida Error: {message.get('description', 'No description')}")
        print(f"    Stack: {message.get('stack', 'No stack trace')}")
        print(f"    Details: File {message.get('fileName', 'N/A')}, Line {message.get('lineNumber', 'N/A')}, Col {message.get('columnNumber', 'N/A')}")
    else:
        print(f"[*] Frida Message: {message}")

# --- Helper Function ---
def is_right():
    """Compares the current attempt's score with the best known score."""
    global new_number, number
    if new_number > number:
        # print(f"[*] New best score found: {new_number} > {number}") # Optional debug
        number = new_number
        return True
    else:
        # print(f"[*] Score {new_number} is not better than {number}") # Optional debug
        return False

# --- Main Execution Logic ---
def main():
    global number, new_number # Allow modification of globals

    # Check if hook script exists
    if not os.path.exists(HOOK_SCRIPT_FILE):
        print(f"[!] Error: Hook script '{HOOK_SCRIPT_FILE}' not found.")
        sys.exit(1)

    # Load Frida JScode
    try:
        with open(HOOK_SCRIPT_FILE, "r", encoding="utf-8") as f:
            jscode = f.read()
    except Exception as e:
        print(f"[!] Error reading hook script '{HOOK_SCRIPT_FILE}': {e}")
        sys.exit(1)

    flag = FLAG_KNOWN_PREFIX
    print(f"[*] Starting bruteforce for flag (expected length: {FLAG_TOTAL_LENGTH})")
    print(f"[*] Initial known prefix: '{flag}'")

    # Bruteforce loop for characters from current length up to target content length
    # Example: if flag="flag{", len=5. Loop from 5 up to 43 (exclusive)
    # because the 44th char (index 43) is always "}"
    for index in range(len(flag), FLAG_TOTAL_LENGTH - 1):
        found_char_for_index = False
        print(f"\n[*] Trying index: {index}")

        # Iterate through possible characters for the current position
        for char_to_try in PRINTABLE_CHARS:
            # Reset new_number for each attempt
            new_number = 0

            # Construct the test flag: current_flag + guess + padding + "}"
            tmp_flag = (flag + char_to_try).ljust(FLAG_CONTENT_PAD_LENGTH, PADDING_CHAR) + "}"
            print(f"    Trying char: '{char_to_try}' -> Input: \"{tmp_flag}\"")

            process = None
            session = None
            try:
                # Start the target process for each guess
                process = subprocess.Popen(
                    [TARGET_EXE], # Pass exe name as a list for robustness
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    universal_newlines=True # Use text mode for stdin/stdout/stderr
                )

                # Attach Frida to the newly started process
                # Add a small delay or retry logic if attachment fails immediately
                try:
                    session = frida.attach(process.pid)
                except frida.ProcessNotFoundError:
                    print(f"[!] Error: Could not find process {process.pid} immediately. Maybe it exited too quickly?")
                    # Clean up the zombie process if Popen succeeded but attach failed
                    if process and process.poll() is None:
                         process.terminate()
                         process.wait() # Ensure termination
                    continue # Skip to the next character
                except Exception as e:
                    print(f"[!] Error attaching Frida to PID {process.pid}: {e}")
                    if process and process.poll() is None:
                         process.terminate()
                         process.wait()
                    continue # Skip to the next character

                # Create and load the Frida script
                script = session.create_script(jscode)
                script.on('message', on_message)
                script.load()

                # Send the crafted input flag to the process
                # process.communicate handles writing, closing stdin, and waiting
                output, error = process.communicate(input=tmp_flag)

                # Script execution continues after communicate() finishes (process exits)

                # --- Decision Logic ---
                # Calibrate 'number' using the '`' character score on the first attempt for this index
                if char_to_try == PRINTABLE_CHARS[0]: # Check if it's the calibration char ('`')
                    print(f"    Calibration with '{char_to_try}': Setting base score to {new_number}")
                    number = new_number # Set the baseline score for this index

                # Check if the current character yielded a better score
                elif is_right():
                    flag += char_to_try
                    print(f"\n[+] Correct character found: '{char_to_try}'")
                    print(f"[+] Current Flag: {flag}\n")
                    found_char_for_index = True
                    # Detach Frida session cleanly (optional but good practice)
                    session.detach()
                    break # Move to the next index

                # Detach Frida session if it was successfully attached
                session.detach()

            except frida.InvalidOperationError as e:
                print(f"[!] Frida Error (e.g., process terminated before detach): {e}")
            except Exception as e:
                print(f"[!] An unexpected error occurred: {e}")
                # Ensure process is terminated if it's still running
                if process and process.poll() is None:
                    try:
                        process.terminate()
                        process.wait(timeout=1) # Wait briefly
                    except subprocess.TimeoutExpired:
                        process.kill() # Force kill if terminate fails
                    except Exception as term_err:
                        print(f"[!] Error during process cleanup: {term_err}")
                # Ensure session is detached if it exists
                if session:
                    try:
                        session.detach()
                    except Exception as detach_err:
                        print(f"[!] Error during session detach cleanup: {detach_err}")

            finally:
                 # Ensure the process is terminated, even if errors occurred
                 # Note: communicate() already waits for termination.
                 # terminate() here is mostly a safeguard.
                if process and process.poll() is None: # Check if still running
                    # print(f"    Terminating process {process.pid}...") # Optional debug
                    process.terminate()
                    try:
                        process.wait(timeout=1) # Wait briefly for termination
                    except subprocess.TimeoutExpired:
                        print(f"    Process {process.pid} did not terminate gracefully, killing.")
                        process.kill() # Force kill if necessary
                # else:
                    # print(f"    Process {process.pid} already terminated.") # Optional debug

        # If no character was found for the current index after trying all possibilities
        if not found_char_for_index:
            print(f"\n[!] Could not find correct character for index {index}.")
            print(f"[!] Exiting. Current flag guess: {flag}")
            sys.exit(1) # Exit if stuck

    # Final flag includes the closing brace (already added in tmp_flag construction)
    # We just need to ensure the loop completed successfully.
    final_flag = flag + "}" # Add the final brace if loop completed
    if len(final_flag) == FLAG_TOTAL_LENGTH:
        print("\n" + "="*20)
        print(f"[+] Bruteforce Complete!")
        print(f"[+] Final Flag: {final_flag}")
        print("="*20)
    else:
         print("\n[!] Bruteforce finished, but flag length is incorrect.")
         print(f"[!] Result: {final_flag} (Length: {len(final_flag)}, Expected: {FLAG_TOTAL_LENGTH})")

if __name__ == "__main__":
    main()

```

```jsx
// hook.js
var number = 0
function main()
{
    var base =  Module.findBaseAddress("ezVM.exe")
    //console.log("inject success!!!")
    //console.log("base:",base)
    if(base){
        Interceptor.attach(base.add(0x1044), {
                onEnter: function(args) {
                   //console.log("number",number)
                    number+=1
                }
            });

            Interceptor.attach(base.add(0x0113f), {
                onEnter: function(args) {
                    // console.log("end!",number)
                    send(number)
                }

            });
    }
}
setImmediate(main);

```

![](/assets/img/2025-5~1/output.png){: width="972" height="589" }

The last verification does not leak side-channel info, so brute-force the last character to retrieve the flag.

```python
import subprocess

base_flag = 'flag{O1SC_VM_1s_h4rd_to_r3v3rs3_#a78abffaa }'
executable = "ezVm.exe"

for i in range(32, 128):
    char = chr(i)
    test_flag = base_flag.replace(" ", char)

    process = subprocess.Popen(
        [executable],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    # Send inputs to receive outputs / errors; communicate will wait the process to complete
    output, error = process.communicate(input=test_flag)

    if "Invalid" not in output:
        print(f"Found potential flag: {test_flag}")
        print(f"Output: {output.strip()}")
        if error:
            print(f"Stderr: {error.strip()}")
        break

```

![](/assets/img/2025-5~1/output_2.png){: width="972" height="589" }

`flag{O1SC_VM_1s_h4rd_to_r3v3rs3_#a78abffaa#}`

> One Instruction Set Computer: One instruction, multi operations.
{: .prompt-info}

## [miniL 2025] rbf

Reversing [Brainfuck](https://en.wikipedia.org/wiki/Brainfuck), two method:

1. Symbolic execution
2. Dump runtime memory and analyze

## [ACTF 2025] [Unstoppable](https://github.com/team-s2/ACTF-2025/blob/main/reverse/unstoppable/solution.md)

This challenge implements a [busy beaver problem](https://en.wikipedia.org/wiki/Busy_beaver), aiming to find all stoppable Turing machines.

> *In theoretical computer science, the busy beaver game aims to find **a terminating program** of a given size that (depending on definition) either produces the **most output** possible, or runs for the **longest number of steps**. Since an endlessly looping program producing infinite output or running for infinite time is easily conceived, such programs are excluded from the game. Rather than traditional programming languages, the programs used in the game are **n-state [Turing machines](https://en.wikipedia.org/wiki/Turing_machine)**, one of the first mathematical models of computation.*

The program takes `2703` integers as input. We must find all (`2703`) stoppable VMs.

Thus, it's a crackme challenge that requires the user to input the correct sequence of numbers to retrieve the flag.

Key takeaways of `main()`:

```c
  while ( check_if_deref_not_equal(&VM.VM_number, &VM.max_VM) )
  {
    VM.VM_number_0 = take_offset_32_ret_ptr(&VM.VM_number);
    write_data_func(&VM, &bunch_of_bytes + 30 * *VM.VM_number_0);
    execution_count = VM_exec_loop(&VM);// The correct VM will be stoppable
    x = seed;
    base = offset_8x_plus_deref(base_addr, *VM.VM_number_0);// base_addr + offset * 8
    y = do_some_math(&unk_3DBC9, *base, execution_count);// _, base, exp
    seed = multi_mod(&unk_3DBC8, x, y);
    delete_VM(&VM);
    apply_Rb_tree_increment(&VM.VM_number);
  }
  check("Congratulations!", 0x18uLL, seed, output);

```

Reverse engineering `VM_exec_loop()`:

```c
uint64_t __fastcall VM_exec_loop(VMContext *VM_1)
{
  do
  {
    ++VM->instr_counter;
    if ( *add_two_args(&VM->tape_base_ptr, VM->read_write_head) != 0 )
    {
      ptr_1 = cal_op_offset(VM, LOBYTE(VM->IP)) + 3;// ptr_1 = code_base + 6*IP +3
      ptr_final = ptr_1;
    }
    else
    {
      ptr_2 = cal_op_offset(VM, LOBYTE(VM->IP));// ptr_2 = code_base + 6*IP
      ptr_final = ptr_2;
    }
    LO_WORD = *ptr_final;
    HI_BYTE = *(ptr_final + 2);
    LO_CHAR_1 = LO_WORD;
    *add_two_args(&VM->tape_base_ptr, VM->read_write_head) = LO_CHAR_1;// Write to tape
    if ( HIBYTE(LO_WORD) )                      // Determine which direction to move
    {
      offset = VM->read_write_head;
      if ( offset == get_data_buffer_size(&VM->tape_base_ptr) - 1 )
      {
        num = 0;
        expand_data(&VM->tape_base_ptr, &num);
      }
      ++VM->read_write_head;
    }
    else
    {
      if ( VM->read_write_head == 0 )
      {
        p_tape_base_ptr = &VM->tape_base_ptr;
        data_base_ptr = direct_ret(&VM->tape_base_ptr);
        direct_assign(&data_base_ptr_1, &data_base_ptr);
        num_1 = 0;
        alloc_and_insert_bytecode(p_tape_base_ptr, data_base_ptr_1, &num_1);
        ++VM->read_write_head;
      }
      --VM->read_write_head;
    }
    LOBYTE(VM->IP) = HI_BYTE;
  }
  while ( LOBYTE(VM->IP) != 0x19 );             // halt condition
  return VM->instr_counter;
}

```

Brief analysis of the logic:

![](/assets/img/2025-5~1/vm_logic.png)

After reversing the `VM_exec_loop()`, we can dump the bytecode (`bunch_of_bytes`) and write a script to brute-force all 5005 numbers of Turing machines, identifying stoppable machines (where `execution_count <= 47176870`)

```c
// brute-force_stoppable_VMs.cpp
#include <cstdio>
#include <vector>
#include <cstdint>
#include <omp.h>
#include "op.hpp" // VMs dumped -> uint8_t program[5005][30]

using namespace std;

int main()
{
    int ALLN = 5005;
    setvbuf(stdout, nullptr, _IONBF, 0);
    #pragma omp parallel for
    for (int i = 0; i < ALLN; i++)
    {
        vector<uint8_t> tape(1024, 0);
        uint64_t read_write_header = 511;
        uint64_t now_count = 0;
        uint8_t IP = 0;

        while (now_count < 47176870)
        {
            now_count++;
            uint8_t* operation = program[i] + 3 * ((IP << 1) | (tape[read_write_header] != 0)); // states: IP
            tape[read_write_header] = operation[0];
            if (operation[1])
            {
                read_write_header++;
                if (read_write_header == tape.size())
                {
                    tape.insert(tape.end(), tape.size(), 0);
                }
            }
            else
            {
                if (read_write_header == 0)
                {
                    read_write_header += tape.size();
                    tape.insert(tape.begin(), tape.size(), 0);
                }
                read_write_header--;
            }
            IP = operation[2];
            if (IP == 0x19)
            {
                printf("%d ", i);
                break;
            }
        }
    }
    return 0;
}

```