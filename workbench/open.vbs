' Memory Workbench - windowless launcher
' Called by the shortcut: start the server if needed, then open the browser.
' Keep this file pure ASCII: VBScript reads it in the system code page.
Option Explicit
Dim sh, fso, here, node, script
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
node = "node"
script = here & "\open.mjs"
sh.Run """" & node & """ """ & script & """", 0, False
