"""index.html의 로컬 파일 버전(?v=...)을 지금 시각으로 올린다.

JS·CSS를 고쳐 배포하기 전에 실행하면 사용자 브라우저가 캐시된 예전 파일과 섞어 쓰지 않는다.

  python tools/bump_version.py
"""
import re
import sys
from datetime import datetime
from pathlib import Path

index = Path(__file__).resolve().parent.parent / "index.html"
text = index.read_text(encoding="utf-8")
pattern = re.compile(r'((?:src|href)="(?!https?:)[^"?]+\.(?:js|css))\?v=[0-9A-Za-z]+"')
old = sorted(set(re.findall(r'\?v=([0-9A-Za-z]+)"', text)))
version = datetime.now().strftime("%Y%m%d%H%M")
updated, count = pattern.subn(rf'\1?v={version}"', text)
if not count:
    sys.exit("버전 표시(?v=)가 붙은 파일을 찾지 못했습니다.")
index.write_text(updated, encoding="utf-8", newline="")
print(f"index.html: {count}개 파일 버전 {', '.join(old)} → {version}")
