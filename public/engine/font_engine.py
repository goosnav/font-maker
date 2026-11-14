import io, json, re, math
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.qu2cuPen import Qu2CuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.varLib.instancer import instantiateVariableFont

EM = 2048
fonts = {}

def load_font(key):
    if key not in fonts:
        f = TTFont('/fonts/' + key + '.ttf', lazy=False)
        if 'fvar' in f:
            f = instantiateVariableFont(f, {a.axisTag:a.defaultValue for a in f['fvar'].axes}, inplace=False)
        fonts[key] = f
    return fonts[key]

def name_value(font, name_id):
    return next((n.toUnicode() for n in font['name'].names if n.nameID == name_id), '')

def extract_kerning(f, cmap, scale):
    reverse = {}
    for cp, name in cmap.items():
        reverse.setdefault(name, []).append(cp)
    pairs = {}
    def add(left, right, value):
        if not value: return
        for a in reverse.get(left, []):
            for b in reverse.get(right, []):
                if len(pairs) >= 100000: return
                pairs[f'{a},{b}'] = round(value * scale)
    if 'kern' in f:
        for table in f['kern'].kernTables:
            for (left, right), value in getattr(table, 'kernTable', {}).items():
                add(left, right, value)
    if 'GPOS' in f:
        gpos = f['GPOS'].table
        features = getattr(getattr(gpos, 'FeatureList', None), 'FeatureRecord', [])
        indices = {i for feature in features if feature.FeatureTag == 'kern' for i in feature.Feature.LookupListIndex}
        for index in indices:
            lookup = gpos.LookupList.Lookup[index]
            for table in lookup.SubTable:
                if lookup.LookupType == 9:
                    if table.ExtensionLookupType != 2: continue
                    table = table.ExtSubTable
                elif lookup.LookupType != 2: continue
                if table.Format == 1:
                    for left, pair_set in zip(table.Coverage.glyphs, table.PairSet):
                        for record in pair_set.PairValueRecord:
                            add(left, record.SecondGlyph, getattr(record.Value1, 'XAdvance', 0))
                elif table.Format == 2:
                    right_classes = {}
                    for right in reverse:
                        right_classes.setdefault(table.ClassDef2.classDefs.get(right, 0), []).append(right)
                    for left in table.Coverage.glyphs:
                        row = table.Class1Record[table.ClassDef1.classDefs.get(left, 0)]
                        for class_id, entry in enumerate(row.Class2Record):
                            value = getattr(entry.Value1, 'XAdvance', 0)
                            if value:
                                for right in right_classes.get(class_id, []): add(left, right, value)
    return pairs

def inspect_font(key):
    f = load_font(key)
    scale = EM / f['head'].unitsPerEm
    cmap = f.getBestCmap() or {}
    metrics = {str(cp):round(f['hmtx'][name][0]*scale) for cp,name in cmap.items() if 32 <= cp <= 0x10ffff and not 0xd800 <= cp <= 0xdfff}
    os2 = f.get('OS/2')
    return {'name':name_value(f,16) or name_value(f,1), 'style':name_value(f,17) or name_value(f,2),
            'copyright':name_value(f,0),'license':name_value(f,13), 'metrics':metrics,
            'kerning':extract_kerning(f,cmap,scale),
            'ascender':round(f['hhea'].ascent*scale), 'descender':round(abs(f['hhea'].descent)*scale),
            'capHeight':round(getattr(os2,'sCapHeight',EM*.7/scale)*scale),
            'xHeight':round(getattr(os2,'sxHeight',EM*.5/scale)*scale),
            'weight':getattr(os2,'usWeightClass',400),'italic':bool(getattr(os2,'fsSelection',0)&1)}

def glyph_name(cp):
    return ('uni%04X' if cp <= 65535 else 'u%05X') % cp

def build_font(request):
    project = request['project']
    kind = request['format']
    ttf = kind == 'ttf'
    settings = project['settings']
    units = math.lcm(EM, settings.get('resolution',16)) if settings.get('mode')=='pixel' else EM
    if units > 16384: raise ValueError('Choose a supported pixel resolution')
    export_scale = units / EM
    records = {int(g['cp']):g for g in request['glyphs']}
    order = ['.notdef'] + [glyph_name(cp) for cp in sorted(records)]
    fb = FontBuilder(units, isTTF=ttf)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp:glyph_name(cp) for cp in records})
    outlines, metrics, bounds_by_name = {}, {}, {}
    all_y = [settings['ascender']*export_scale, -settings['descender']*export_scale]
    by_name={glyph_name(cp):cp for cp in records}
    for name in order:
        cp = by_name.get(name)
        g = records.get(cp,{})
        width = round(g.get('advance',1024)*export_scale)
        if ttf:
            raw_pen = TTGlyphPen(None)
            pen = Cu2QuPen(raw_pen, max_err=0.5, reverse_direction=False)
        else:
            raw_pen = T2CharStringPen(width, None)
            pen = Qu2CuPen(raw_pen, max_err=0.5, all_cubic=True)
        pen = TransformPen(pen,(export_scale,0,0,export_scale,0,0))
        xs = []
        def replay(record,dx=0,dy=0,depth=0):
            if depth > 8: raise ValueError('Circular or overly deep accent components')
            target = TransformPen(pen,(1,0,0,1,dx,dy))
            if record.get('base') and not record.get('contours'):
                f=load_font(record['base']); gs=f.getGlyphSet(); source=(f.getBestCmap() or {}).get(record['cp'])
                if source:
                    rp=DecomposingRecordingPen(gs); gs[source].draw(rp)
                    if not ttf:
                        normalized=[]
                        for operation,points in rp.value:
                            if operation=='qCurveTo' and points[-1] is None:
                                first,last=points[0],points[-2]
                                start=((first[0]+last[0])/2,(first[1]+last[1])/2)
                                normalized.append(('moveTo',(start,)))
                                points=points[:-1]+(start,)
                            normalized.append((operation,points))
                        rp.value=normalized
                    scale=EM/f['head'].unitsPerEm
                    rp.replay(TransformPen(target,(scale,0,0,scale,0,0)))
            for contour in record.get('contours',[]):
                if len(contour)<3: continue
                target.moveTo(contour[0])
                for x,y in contour[1:]: target.lineTo((x,y))
                target.closePath()
                xs.extend(x+dx for x,y in contour); all_y.extend((y+dy)*export_scale for x,y in contour)
            for component in record.get('components',[]):
                child=records.get(component['cp'])
                if child: replay(child,dx+component['x'],dy+component['y'],depth+1)
        if name == '.notdef':
            for points in [[(128,0),(128,1408),(896,1408),(896,0)],[(256,128),(768,128),(768,1280),(256,1280)]]:
                pen.moveTo(points[0])
                for pt in points[1:]: pen.lineTo(pt)
                pen.closePath()
        else: replay(g)
        if ttf:
            outline=raw_pen.glyph()
            if outline.numberOfContours:
                outline.recalcBounds(None)
                all_y.extend([outline.yMin,outline.yMax])
                bounds_by_name[name]=(outline.xMin,outline.yMin,outline.xMax,outline.yMax)
            bearing=getattr(outline,'xMin',0)
            outlines[name]=outline
        else:
            outlines[name]=raw_pen.getCharString(private=None,globalSubrs=None)
            bearing=int(min(xs)) if xs else 0
        metrics[name]=(width,bearing)
    family=project['name'].strip()[:100] or 'Untitled Font'
    style=project.get('styleName','Regular')[:60]
    ps=re.sub(r'[^A-Za-z0-9-]','',family+'-'+style)[:63] or 'GoosnavFont-Regular'
    if ttf: fb.setupGlyf(outlines)
    else:
        fb.setupCFF(ps,{'FullName':family+' '+style,'FamilyName':family,'Weight':str(project.get('weight',400))},outlines,{})
        for name,outline in outlines.items():
            bounds=outline.calcBounds(None)
            if bounds:
                bounds_by_name[name]=bounds
                metrics[name]=(metrics[name][0],int(bounds[0]))
                all_y.extend([bounds[1],bounds[3]])
    fb.setupHorizontalMetrics(metrics)
    ascent=int(max(all_y)); descent=int(min(all_y))
    fb.setupHorizontalHeader(ascent=ascent,descent=descent,lineGap=0)
    fb.setupNameTable({'familyName':family,'styleName':style,'uniqueFontIdentifier':f'{project["id"]}-{project.get("styleId","")}-{project["revision"]}',
                      'fullName':family+' '+style,'psName':ps,'version':'Version 1.000',
                      'typographicFamily':family,'typographicSubfamily':style,
                      'copyright':request.get('copyright',''),'licenseDescription':request.get('license','')})
    bold=project.get('weight',400)>=700; italic=project.get('italic',False)
    selection=(1 if italic else 0)|(32 if bold else 0)|(64 if not bold and not italic else 0)
    fb.setupOS2(sTypoAscender=ascent,sTypoDescender=descent,sTypoLineGap=0,usWinAscent=max(0,ascent),usWinDescent=max(0,-descent),
                sxHeight=round(settings['xHeight']*export_scale),sCapHeight=round(settings['capHeight']*export_scale),usWeightClass=project.get('weight',400),fsSelection=selection,fsType=0)
    fb.setupPost(italicAngle=-12 if italic else 0, isFixedPitch=int(settings['monospace']))
    fb.setupMaxp()
    fb.font['head'].macStyle=(1 if bold else 0)|(2 if italic else 0)
    features=['languagesystem DFLT dflt;','languagesystem latn dflt;','languagesystem grek dflt;','languagesystem cyrl dflt;']
    pairs=[]
    for pair,value in project.get('kerning',{}).items():
        left,right=map(int,pair.split(','))
        if left in records and right in records: pairs.append(f'pos {glyph_name(left)} {glyph_name(right)} {round(value*export_scale)};')
    if pairs: features+=['feature kern {',*pairs,'} kern;']
    import unicodedata
    marks=[cp for cp in records if unicodedata.category(chr(cp)).startswith('M')]
    if marks:
        def mark_class(cp):
            combining=unicodedata.combining(chr(cp))
            if combining==1: return 'CENTER'
            if 'BELOW' in unicodedata.name(chr(cp),'') or combining in (202,218,220,222,233,240): return 'BOTTOM'
            return 'TOP'
        def anchor_for(cp,position,is_mark=False):
            g=records[cp]
            if g.get('anchor'): return [round(n*export_scale) for n in g['anchor']]
            bounds=bounds_by_name.get(glyph_name(cp),(0,0,g['advance']*export_scale,settings['capHeight']*export_scale))
            x=(bounds[0]+bounds[2])/2
            if position=='CENTER': y=(bounds[1]+bounds[3])/2
            elif position=='BOTTOM': y=bounds[3] if is_mark else bounds[1]-64*export_scale
            else: y=bounds[1] if is_mark else bounds[3]+64*export_scale
            return round(x),round(y)
        classes=sorted({mark_class(cp) for cp in marks})
        for cp in marks:
            position=mark_class(cp); x,y=anchor_for(cp,position,True)
            features.append(f'markClass {glyph_name(cp)} <anchor {x} {y}> @{position};')
        features.append('feature mark {')
        for cp,g in records.items():
            if cp not in marks and not chr(cp).isspace():
                for position in classes:
                    x,y=anchor_for(cp,position)
                    features.append(f'pos base {glyph_name(cp)} <anchor {x} {y}> mark @{position};')
        features.append('} mark;')
    if len(features)>4: addOpenTypeFeaturesFromString(fb.font,'\n'.join(features))
    out=io.BytesIO();fb.save(out)
    verified=TTFont(io.BytesIO(out.getvalue()),checkChecksums=2)
    assert verified.getBestCmap()=={cp:glyph_name(cp) for cp in records}
    return out.getvalue()

def dispatch(text):
    req=json.loads(text)
    if req['op']=='inspect': return json.dumps(inspect_font(req['source']))
    if req['op']=='build': return build_font(req)
    raise ValueError('Unknown font operation')
