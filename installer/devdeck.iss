; devdeck installer (Inno Setup 6). Built by `mise run package` (scripts/package.ps1), which
; passes the version: ISCC /DAppVersion=1.2.3 installer\devdeck.iss
#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#define AppExe "devdeck.exe"

[Setup]
; The id is what makes a newer installer update an installed devdeck instead of adding a second one.
AppId={{8F3B5C1E-6A27-4D0F-9B6E-2D4C7A91E0B5}
AppName=devdeck
AppVersion={#AppVersion}
AppPublisher=devdeck
AppPublisherURL=https://github.com/shadovxw/devdeck
DefaultDirName={autopf}\devdeck
DefaultGroupName=devdeck
DisableProgramGroupPage=yes
; Per user, in %LocalAppData%\Programs: no administrator prompt.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=devdeck-setup-{#AppVersion}
SetupIconFile=..\build\windows\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; An installed devdeck that is running is closed for the update and started again after it.
CloseApplications=yes
RestartApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "autostart"; Description: "Start devdeck when I &sign in to Windows"; GroupDescription: "Startup:"; Flags: unchecked
Name: "addtopath"; Description: "Add devdeck to my &PATH, to use devdeck in a terminal (devdeck status, devdeck up)"; GroupDescription: "Command line:"; Flags: unchecked

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\devdeck"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\devdeck"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "devdeck"; ValueData: """{app}\{#AppExe}"""; Tasks: autostart; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addtopath; Check: NeedsAddPath(ExpandConstant('{app}'))

[Run]
Filename: "{app}\{#AppExe}"; Description: "Open devdeck"; Flags: nowait postinstall skipifsilent

[Code]
const
  // The Microsoft Edge WebView2 runtime shows devdeck's window. Windows 11 has it.
  WebView2Key = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Bootstrapper = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

function WebView2Installed: Boolean;
var
  v: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\' + WebView2Key, 'pv', v) and (v <> '') and (v <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, WebView2Key, 'pv', v) and (v <> '') and (v <> '0.0.0.0'));
end;

function NeedsAddPath(Param: String): Boolean;
var
  p: String;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', p) then p := '';
  Result := Pos(';' + Lowercase(Param) + ';', ';' + Lowercase(p) + ';') = 0;
end;

procedure InstallWebView2;
var
  setup: String;
  code: Integer;
begin
  if WebView2Installed then Exit;
  try
    setup := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
    DownloadTemporaryFile(WebView2Bootstrapper, 'MicrosoftEdgeWebview2Setup.exe', '', nil);
    Exec(setup, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, code);
  except
    // No network or the install failed: say so, since devdeck's window needs it.
    MsgBox('devdeck needs the Microsoft Edge WebView2 runtime to show its window, and it could not be installed now.' + #13#10 +
           'Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and start devdeck again.', mbInformation, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then InstallWebView2;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  p, app: String;
  i: Integer;
begin
  // Take devdeck out of the PATH again. Its data (%AppData%\devdeck) is left alone.
  if CurUninstallStep = usUninstall then begin
    if RegQueryStringValue(HKCU, 'Environment', 'Path', p) then begin
      app := ExpandConstant('{app}');
      i := Pos(';' + Lowercase(app), Lowercase(p));
      if i > 0 then begin
        Delete(p, i, Length(app) + 1);
        RegWriteExpandStringValue(HKCU, 'Environment', 'Path', p);
      end;
    end;
  end;
end;
