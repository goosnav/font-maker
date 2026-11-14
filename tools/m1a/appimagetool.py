#!/usr/bin/env python3
"""Assemble a Type 2 AppImage from a verified runtime and a SquashFS payload."""
import os,sys,tempfile,subprocess
from pathlib import Path
root=Path(os.environ['GOOSNAV_APPIMAGE_RUNTIMES'])
appdir,output=map(Path,sys.argv[1:3])
arch=os.environ['ARCH']
with tempfile.TemporaryDirectory() as tmp:
    image=Path(tmp)/'filesystem.squashfs'
    subprocess.run(['mksquashfs',str(appdir),str(image),'-noappend','-all-root','-comp','gzip','-no-xattrs','-quiet'],check=True)
    with output.open('wb') as dest:
        dest.write((root/('runtime-'+arch)).read_bytes())
        dest.write(image.read_bytes())
    output.chmod(0o755)
