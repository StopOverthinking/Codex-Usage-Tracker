# Codex Usage Tracker

[English README](README.md)

Stream Deck 키에서 로컬 Codex 사용량 제한을 보여주는 플러그인입니다. 5시간 창과 주간 사용량 창을 함께 표시하고, 플랜과 초기화 시간 같은 세부 정보도 확인할 수 있습니다.

## 기능

- 5시간 및 주간 사용량 창의 남은 Codex 사용량을 표시합니다.
- 짧게 누르면 사용량 보기와 세부 정보 보기를 전환합니다.
- 길게 누르면 사용량 데이터를 즉시 새로고침합니다.
- 사용자 지정 Codex 실행 파일 경로를 지원합니다.
- Windows Store 설치와 오래된 로컬 세션 스냅샷을 위한 fallback을 포함합니다.

## 요구 사항

- Elgato Stream Deck 7.1 이상.
- Windows 10 이상 또는 macOS 12 이상.
- `codex app-server`를 지원하는 로컬 `codex` 설치.
- 같은 컴퓨터에서 활성화된 Codex 로그인.

## 설치

최신 GitHub 릴리스에서 `com.codexusage.tracker.streamDeckPlugin`을 다운로드한 뒤 실행하세요. Stream Deck이 플러그인을 자동으로 가져옵니다.

설치 후 **Codex Overview** 액션을 키에 추가하세요. Codex를 자동으로 찾지 못하면 액션 설정을 열고 `codex` 실행 파일의 전체 경로를 지정하세요.

## 데이터 소스

플러그인은 로컬에서 Codex를 다음 명령으로 시작합니다.

```powershell
codex app-server --listen stdio://
```

그다음 아래 호출을 실행합니다.

```text
account/rateLimits/read
```

플러그인은 `~/.codex/auth.json`의 토큰 값을 읽거나 로그로 남기지 않습니다.

로컬 Codex app-server를 사용할 수 없으면 선택 사항인 세션 파일 fallback이 `~/.codex/sessions`에서 가장 최근에 기록된 rate-limit 스냅샷을 읽습니다. 이 fallback에서 가져온 값은 stale 상태로 표시됩니다.

Windows Store 설치에서는 운영체제 정책 때문에 `C:\Program Files\WindowsApps`에서 직접 실행이 차단될 수 있습니다. WindowsApps fallback을 활성화하면 Codex 실행 파일을 `~/.codex-streamdeck-usage/codex-bin/`로 복사한 뒤 그 복사본을 실행합니다.

## 설정

- **Codex path**: 선택 사항인 사용자 지정 `codex` 실행 파일 경로입니다.
- **Refresh**: 자동 새로고침 간격 또는 수동 전용 모드입니다.
- **Limit bucket**: rate-limit bucket id입니다. 기본값은 `codex`입니다.
- **Screen**: 사용량 보기 또는 세부 정보 보기입니다.
- **Allow WindowsApps copy fallback**: Microsoft Store Codex 설치에서 도움이 됩니다.
- **Use session-file fallback**: app-server 호출이 실패하면 가장 최근의 로컬 스냅샷을 표시합니다.

## 개발

의존성을 설치합니다.

```powershell
npm install
```

플러그인을 빌드, 검증, 패키징합니다.

```powershell
npm run clean
npm run validate
npm run pack
```

Codex API 직접 smoke test를 실행합니다.

```powershell
npm run smoke -- "C:\path\to\codex.exe"
```

패키징된 플러그인은 아래 경로에 생성됩니다.

```text
dist/com.codexusage.tracker.streamDeckPlugin
```

## 릴리스

릴리스 자산에는 `dist/`에서 생성된 패키징된 `.streamDeckPlugin` 파일을 포함하면 됩니다. 소스 파일, `node_modules`, 빌드 중간 산출물은 최종 사용자에게 필요하지 않습니다.
