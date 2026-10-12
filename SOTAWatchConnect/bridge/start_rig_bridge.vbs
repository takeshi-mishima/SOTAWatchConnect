Set shell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' --- Input validation for rigs.csv ---
' Values from rigs.csv are pasted into a "cmd /c" command line, so they
' are checked against strict patterns first (prevents command injection
' such as "COM7 & calc.exe"). Rows that fail are skipped and recorded in
' logs\rigs_csv_skipped.log.
Function NewRegExp(pattern)
    Dim r
    Set r = New RegExp
    r.Pattern = pattern
    r.IgnoreCase = True
    r.Global = False
    Set NewRegExp = r
End Function

Function IsValidRig(model, com, baud, port)
    IsValidRig = False
    If Not NewRegExp("^[0-9]{1,5}$").Test(model) Then Exit Function
    If Not NewRegExp("^COM[0-9]{1,3}$").Test(com) Then Exit Function
    If Not NewRegExp("^[0-9]{3,6}$").Test(baud) Then Exit Function
    If Not NewRegExp("^[0-9]{1,5}$").Test(port) Then Exit Function
    If CLng(port) < 1 Or CLng(port) > 65535 Then Exit Function
    IsValidRig = True
End Function

Sub LogSkipped(logDir, msg)
    Dim f
    On Error Resume Next
    Set f = fso.OpenTextFile(logDir & "\rigs_csv_skipped.log", 8, True) ' 8 = ForAppending
    f.WriteLine Now & "  skipped (invalid value): " & msg
    f.Close
    On Error GoTo 0
End Sub

currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' --- Hamlib auto-start configuration ---
' Rig list is read from rigs.csv in this folder (columns:
' name,model,com_port,baud,rigctld_port). One rigctld instance is
' started per row, each on its own TCP port, so multiple rigs can be
' controlled independently.
'
' If rigctld is not in your PATH, set the full path below. If the
' path contains spaces, keep it wrapped in double quotes, e.g.:
'   RIGCTLD_EXE = """C:\Program Files\hamlib-w64-4.7.0\bin\rigctld"""
RIGCTLD_EXE = "rigctld"

' Logging options passed to rigctld. Output is appended to
' logs\rigctld_<model>.log (one file per rig model number).
' For troubleshooting, use more -v (e.g. "-vvvvv"); -Z adds timestamps
' but needs a newer Hamlib (around 4.5+).
RIGCTLD_LOG_OPTS = "-v"

csvPath = currentDir & "\rigs.csv"
logDir = currentDir & "\logs"

If fso.FileExists(csvPath) Then
    If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir

    Set csvFile = fso.OpenTextFile(csvPath, 1) ' 1 = ForReading
    isHeaderRow = True

    Do Until csvFile.AtEndOfStream
        line = Trim(csvFile.ReadLine)

        If line <> "" Then
            If isHeaderRow Then
                ' Skip the "name,model,com_port,baud,rigctld_port" header
                isHeaderRow = False
            Else
                cols = Split(line, ",")
                If UBound(cols) >= 4 Then
                    rigModel     = Trim(cols(1))
                    rigComPort   = Trim(cols(2))
                    rigBaud      = Trim(cols(3))
                    rigCtldPort  = Trim(cols(4))

                    If IsValidRig(rigModel, rigComPort, rigBaud, rigCtldPort) Then
                        logPath = logDir & "\rigctld_" & rigModel & ".log"

                        cmd = RIGCTLD_EXE & " -m " & rigModel & " -r " & rigComPort & _
                              " -s " & rigBaud & " -t " & rigCtldPort & _
                              " " & RIGCTLD_LOG_OPTS & _
                              " >> """ & logPath & """ 2>&1"

                        ' Outer quotes keep cmd /c from mangling the inner quotes
                        shell.Run "cmd /c """ & cmd & """", 0, False
                    Else
                        LogSkipped logDir, line
                    End If
                End If
            End If
        End If
    Loop

    csvFile.Close
Else
    WScript.Echo "rigs.csv not found: " & csvPath & vbCrLf & vbCrLf & _
                 "Copy rigs.sample.csv to rigs.csv in this folder, then edit the COM port and other values for your rig(s)."
End If

' --- Bridge auto-start configuration ---
shell.Run "cmd /c """ & currentDir & "\start_rig_bridge.bat""", 0, False
