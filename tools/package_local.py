#!/usr/bin/env python3
"""Rebuild the universal preview on a Mac with Node, Go, uv, and squashfs-tools."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
M1A=ROOT/'tools/m1a'
RUNTIMES={
 'x86_64':(657374641,'617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46'),
 'aarch64':(657373827,'9a72a744d221576c9347ec074243acc5c3c7568896b12714e0e82e9f0bf47900'),
}
def run(*args,**kwargs):subprocess.run([str(a) for a in args],cwd=ROOT,check=True,**kwargs)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'dist/Goosnav-Font-0.1.3-preview.zip');args=parser.parse_args()
 if sys.platform!='darwin':raise SystemExit('Build the universal macOS image on macOS. Other targets can use tools/m1a/build.py individually.')
 run('npm','run','build')
 run(sys.executable,M1A/'fetch_uv.py','--version','0.11.28','--app-root',ROOT/'app')
 cache=ROOT/'.cache/release-tools';cache.mkdir(parents=True,exist_ok=True)
 for arch,(asset,digest) in RUNTIMES.items():
  dest=cache/('runtime-'+arch)
  if not dest.exists():
   request=urllib.request.Request(f'https://api.github.com/repos/AppImage/type2-runtime/releases/assets/{asset}',headers={'Accept':'application/octet-stream','User-Agent':'Goosnav-Font-build'})
   with urllib.request.urlopen(request) as response:dest.write_bytes(response.read())
  if hashlib.sha256(dest.read_bytes()).hexdigest()!=digest:raise SystemExit(f'AppImage runtime checksum mismatch: {arch}')
 release=ROOT/'release';release.mkdir(exist_ok=True)
 env=os.environ.copy();env['GOOSNAV_APPIMAGE_RUNTIMES']=str(cache)
 for target in ['macos','windows-x64','windows-arm64','linux-x64','linux-arm64']:
  arguments=[sys.executable,M1A/'build.py','--target',target,'--name','Goosnav Font','--bundle-id','com.goosnav.font','--icons',M1A/'icons','--output',release]
  if target.startswith('windows'):
   arch='arm64' if target.endswith('arm64') else 'amd64';resource=cache/f'windows-{arch}.syso'
   run('go','run','github.com/akavel/rsrc@v0.10.2','-arch',arch,'-ico',M1A/'icons/AppIcon.ico','-o',resource)
   arguments+=['--windows-resource',resource]
  if target.startswith('linux'):arguments+=['--appimagetool',M1A/'appimagetool.py']
  run(*arguments,env=env)
 payload=release/'app'
 if payload.exists():shutil.rmtree(payload)
 shutil.copytree(ROOT/'app',payload,ignore=shutil.ignore_patterns('__pycache__','*.pyc','.venv','.DS_Store'))
 for filename in ['README.txt','LICENSE.txt']:shutil.copy2(ROOT/filename,release/filename)
 run(sys.executable,M1A/'package_universal.py','--root',release,'--name','Goosnav Font','--output',args.output.resolve())
 print(args.output.resolve())
if __name__=='__main__':main()
