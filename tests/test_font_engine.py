"""Verify the real TrueType and CFF tables, geometry, and positioning features."""
import sys
sys.dont_write_bytecode = True
import importlib.util
import io
import unittest
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('font_engine', ROOT / 'public/engine/font_engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

class FontEngineTests(unittest.TestCase):
    def request(self, kind):
        ring = [[[0, 0], [0, 1408], [1024, 1408], [1024, 0]],
                [[128, 128], [896, 128], [896, 1280], [128, 1280]]]
        glyphs = [{'cp': cp, 'advance': 1280, 'contours': ring} for cp in [65, 86, 937, 1046]]
        glyphs += [{'cp': 32, 'advance': 640},
                   {'cp': 769, 'advance': 0, 'anchor': [0, 1408],
                    'contours': [[[0, 1536], [128, 1664], [256, 1664], [128, 1536]]]},
                   {'cp': 193, 'advance': 1280, 'components': [{'cp':65,'x':0,'y':0},{'cp':769,'x':512,'y':0}]}]
        return {'format':kind,'project':{'id':'test','revision':1,'name':'Geometry Check','styleName':'Bold Italic',
                'weight':700,'italic':True,'settings':{'ascender':1536,'descender':512,'capHeight':1408,'xHeight':1024,'monospace':False},
                'kerning':{'65,86':-128}},'glyphs':glyphs}

    def test_both_formats_preserve_counters_accents_scripts_and_positioning(self):
        for kind in ['ttf','otf']:
            with self.subTest(format=kind):
                data = engine.build_font(self.request(kind))
                font = TTFont(io.BytesIO(data),checkChecksums=2)
                self.assertEqual(data[:4], b'\x00\x01\x00\x00' if kind=='ttf' else b'OTTO')
                self.assertEqual(set(font.getBestCmap()), {32,65,86,193,769,937,1046})
                self.assertEqual(font['hmtx']['uni0301'][0], 0)
                self.assertEqual(font['hmtx']['uni0041'], (1280,0))
                self.assertEqual(font['OS/2'].usWeightClass,700)
                self.assertEqual(font['head'].macStyle,3)
                features={f.FeatureTag for f in font['GPOS'].table.FeatureList.FeatureRecord}
                self.assertTrue({'kern','mark'}<=features)
                kern=next(l for l in font['GPOS'].table.LookupList.Lookup if l.LookupType==2)
                self.assertEqual(kern.SubTable[0].PairSet[0].PairValueRecord[0].Value1.XAdvance,-128)
                if kind=='ttf':
                    self.assertEqual(font['glyf']['uni0041'].numberOfContours,2)
                    self.assertEqual(font['glyf']['uni00C1'].numberOfContours,3)
                    self.assertEqual(font['glyf']['uni0041'].yMin,0)
                    self.assertTrue(all(x%128==0 and y%128==0 for x,y in font['glyf']['uni00C1'].coordinates))
                else:
                    self.assertIn('CFF ',font)
                    self.assertNotIn('glyf',font)
                    self.assertEqual(font['CFF '].cff.topDictIndex[0].CharStrings['uni0041'].calcBounds(None),(0,0,1024,1408))

    def test_24_pixel_geometry_has_no_fractional_boundaries(self):
        for kind in ['ttf','otf']:
            request=self.request(kind)
            request['project']['settings'].update(mode='pixel',resolution=24)
            step=2048/24
            request['glyphs']=[{'cp':65,'advance':step*4,'contours':[[[0,0],[0,step],[step,step],[step,0]]]}]
            font=TTFont(io.BytesIO(engine.build_font(request)))
            self.assertEqual(font['head'].unitsPerEm,6144)
            self.assertEqual(font['hmtx']['uni0041'][0],1024)
            if kind=='ttf':self.assertEqual(set(font['glyf']['uni0041'].coordinates),{(0,0),(0,256),(256,256),(256,0)})
            else:self.assertEqual(font['CFF '].cff.topDictIndex[0].CharStrings['uni0041'].calcBounds(None),(0,0,256,256))

    def test_detailed_curves_keep_subunit_precision_in_both_formats(self):
        for kind in ['ttf','otf']:
            request=self.request(kind)
            request['project']['settings'].update(mode='detailed',resolution=4096)
            request['glyphs']=[{'cp':65,'advance':1280,'curves':[{'start':[0.25,0.25], 'segments':[
                {'c1':[0.25,800.25],'c2':[1024.25,800.25],'end':[1024.25,0.25]},
                {'end':[0.25,0.25]}]}]}]
            font=TTFont(io.BytesIO(engine.build_font(request)))
            self.assertEqual(font['head'].unitsPerEm,8192)
            self.assertEqual(font['hmtx']['uni0041'][0],5120)
            if kind=='ttf':
                glyph=font['glyf']['uni0041']
                self.assertEqual(glyph.xMin,1)
                self.assertTrue(any(not (flag & 1) for flag in glyph.flags))
            else:
                glyph=font['CFF '].cff.topDictIndex[0].CharStrings['uni0041']
                glyph.decompile()
                self.assertTrue(any('curve' in x for x in glyph.program if isinstance(x,str)))
                self.assertEqual(glyph.calcBounds(None)[0],1)

    def test_imported_outlines_keep_native_shape_and_kerning(self):
        path=ROOT/'public/fonts/liberation-sans.ttf'
        if not path.exists(): self.skipTest('Run npm run assets first')
        engine.fonts['source']=TTFont(path)
        info=engine.inspect_font('source')
        self.assertLess(info['kerning']['65,86'],0)
        for kind in ['ttf','otf']:
            request=self.request(kind)
            request['glyphs']=[{'cp':int(cp),'base':'source','advance':width} for cp,width in info['metrics'].items()]
            font=TTFont(io.BytesIO(engine.build_font(request)))
            self.assertEqual(font['hmtx']['uni0041'][0],info['metrics']['65'])
            if kind=='ttf':self.assertGreater(font['glyf']['uni0041'].yMax,1300)
            else:self.assertGreater(font['CFF '].cff.topDictIndex[0].CharStrings['uni0041'].calcBounds(None)[3],1300)

if __name__=='__main__':unittest.main()
