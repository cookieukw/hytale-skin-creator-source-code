"""Generates catalog.js from official Hytale CharacterCreator JSON assets.

Category ordering and grouping follows MainMenu/MyAvatar/MyAvatarPage.ui,
and labels correspond to in-game UI definitions.
"""
import json
import os
import re

ASSETS = '/mnt/devhd/Assets/'
CC = ASSETS + 'Cosmetics/CharacterCreator/'

# (key, label, icon in ui/icons)
GROUPS = [
    ('head',    'Head',    'Head'),
    ('general', 'General', 'General'),
    ('torso',   'Torso',   'Torso'),
    ('legs',    'Legs',    'Legs'),
    ('capes',   'Capes',   'Capes'),
]

# (app key, label, official json file, icon, group, key in in-game skin JSON)
# The last column maps to UserData/CachedPlayerSkins/<uuid>.json
CATEGORIES = [
    ('hair',          'Haircut',             'Haircuts.json',      'Haircut',       'head',    'haircut'),
    ('eyebrows',      'Eyebrows',            'Eyebrows.json',      'Eyebrows',      'head',    'eyebrows'),
    ('eyes',          'Eyes',                'Eyes.json',          'Eyes',          'head',    'eyes'),
    ('facialHair',    'Facial Hair',         'FacialHair.json',    'FacialHair',    'head',    'facialHair'),
    ('head',          'Head Accessory',      'HeadAccessory.json', 'HeadAccessory', 'head',    'headAccessory'),
    ('faceAccessory', 'Face Accessory',      'FaceAccessory.json', 'FaceAccessory', 'head',    'faceAccessory'),
    ('earAccessory',  'Ear Accessory',       'EarAccessory.json',  'EarAccessory',  'head',    'earAccessory'),

    ('underwear',     'Underwear',           'Underwear.json',     'Underwear',     'general', 'underwear'),
    ('faces',         'Face',                'Faces.json',         'Face',          'general', 'face'),
    ('mouths',        'Mouth',               'Mouths.json',        'Mouth',         'general', 'mouth'),
    ('ears',          'Ears',                'Ears.json',          'Ears',          'general', 'ears'),

    ('undertops',     'Undertop',            'Undertops.json',     'Undertop',      'torso',   'undertop'),
    ('overtops',      'Overtop',             'Overtops.json',      'Overtop',       'torso',   'overtop'),
    ('gloves',        'Gloves',              'Gloves.json',        'Gloves',        'torso',   'gloves'),

    ('pants',         'Pants',               'Pants.json',         'Pants',         'legs',    'pants'),
    ('overpants',     'Legwear',             'Overpants.json',     'Overpants',     'legs',    'overpants'),
    ('shoes',         'Shoes',               'Shoes.json',         'Shoes',         'legs',    'shoes'),

    ('capes',         'Capes',               'Capes.json',         'Cape',          'capes',   'cape'),
]


def resolve(rel):
    """A JSON relative path can reside under asset root or under Common/."""
    if not rel:
        return None
    for base in ('Common/', ''):
        if os.path.exists(ASSETS + base + rel):
            return 'Assets/' + base + rel
    return None


def pick_texture(entry):
    """Returns (relativeTexture, baseColor) from any asset format variant."""
    if entry.get('GreyscaleTexture'):
        return entry['GreyscaleTexture'], None
    textures = entry.get('Textures')
    if textures:
        first = textures[next(iter(textures))]
        return first.get('Texture'), (first.get('BaseColor') or [None])[0]
    return None, None


def pretty(cid):
    s = re.sub(r'[_\-]+', ' ', cid)
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def collect(fname):
    """Reads official JSON file and returns (items, skipped_count)."""
    path = CC + fname
    if not os.path.exists(path):
        return None, 0

    items, skipped = [], 0
    for entry in json.load(open(path)):
        model, tex, base = entry.get('Model'), None, None
        if model:
            tex, base = pick_texture(entry)
        else:
            # Capes/EarAccessory store models inside Variants
            variants = entry.get('Variants') or {}
            if not variants:
                skipped += 1
                continue
            variant = variants[next(iter(variants))]
            model = variant.get('Model')
            tex, base = pick_texture(variant)
            if not tex:
                tex, base = pick_texture(entry)

        model_p, tex_p = resolve(model), resolve(tex)
        if not model_p or not tex_p:
            skipped += 1
            continue
        items.append({'id': entry['Id'], 'name': pretty(entry['Id']),
                      'model': model_p, 'tex': tex_p, 'baseColor': base,
                      'gradientSet': entry.get('GradientSet'),
                      'isDefault': bool(entry.get('IsDefaultAsset')),
                      'hairType': entry.get('HairType'),
                      'requiresGeneric': bool(entry.get('RequiresGenericHaircut')),
                      'headType': entry.get('HeadAccessoryType'),
                      'disablePart': entry.get('DisableCharacterPartCategory')})
    return items, skipped


def main():
    catalog, stats, tabs = {}, [], []

    for key, label, fname, icon, group, gamekey in CATEGORIES:
        items, skipped = collect(fname)
        if items is None:
            stats.append((key, 0, 0, 'missing file'))
            continue
        stats.append((key, len(items), skipped, ''))
        tabs.append((key, label, icon, group, gamekey))

        entries = []
        for it in items:
            e = {'id': it['id'], 'name': it['name'],
                 'model': it['model'], 'tex': it['tex']}
            if it['baseColor']:
                e['baseColor'] = it['baseColor']
            if it['gradientSet']:
                e['gradientSet'] = it['gradientSet']
            if it['hairType']:
                e['hairType'] = it['hairType']
            # Haircuts covering partial head: game renders generic fallback haircut
            # of matching HairType underneath (HaircutFallbacks.json).
            if it['requiresGeneric'] and it['hairType']:
                e['baseHair'] = it['hairType']
            if it['headType']:
                e['headType'] = it['headType']
            if it['disablePart']:
                e['disablePart'] = it['disablePart']
            entries.append(e)

        catalog[key] = [{'name': 'None', 'model': None, 'tex': None}] + entries

    # Intentionally compact: ~180 KB of generated data, not code intended for manual editing.
    # One category per line remains easily inspectable via grep.
    linhas = ',\n'.join(
        '%s:%s' % (json.dumps(k), json.dumps(v, ensure_ascii=False,
                                             separators=(',', ':')))
        for k, v in catalog.items())
    js = ('// GENERATED automatically from Assets/Cosmetics/CharacterCreator/*.json\n'
          '// To regenerate: python3 tools/gen_catalog.py\n'
          'const CATALOG = {\n' + linhas + '\n};\n\n')

    # `icon` is also used as key in myAvatar.tabs.<X> in client.lang, so it doubles as langKey.
    js += 'const CATALOG_GROUPS = [\n'
    for key, label, icon in GROUPS:
        js += '  { id: %s, label: %s, icon: %s, langKey: %s },\n' % (
            json.dumps(key), json.dumps(label), json.dumps(icon), json.dumps(icon))
    js += '];\n\n'

    # Gradient Sets: grayscale texture value indexes a 256x16 LUT
    gsets = {}
    gpath = CC + 'GradientSets.json'
    if os.path.exists(gpath):
        for entry in json.load(open(gpath)):
            ramps = []
            for name, g in (entry.get('Gradients') or {}).items():
                tex = resolve(g.get('Texture'))
                if not tex:
                    continue
                ramps.append((name, tex, (g.get('BaseColor') or [None])[0]))
            if ramps:
                gsets[entry['Id']] = sorted(ramps, key=lambda r: r[0])

    js += 'const GRADIENT_SETS = {\n'
    for sid, ramps in gsets.items():
        js += '  %s: [\n' % json.dumps(sid)
        for name, tex, base in ramps:
            js += '    { name: %s, tex: %s, baseColor: %s },\n' % (
                json.dumps(name), json.dumps(tex), json.dumps(base))
        js += '  ],\n'
    js += '};\n\n'

    # Default items (IsDefaultAsset): base player model equips these by default
    js += 'const DEFAULT_ITEMS = {\n'
    for key, label, fname, icon, group, gamekey in CATEGORIES:
        items, _ = collect(fname)
        d = next((i['id'] for i in (items or []) if i['isDefault']), None)
        if d:
            js += '  %s: %s,\n' % (json.dumps(key), json.dumps(d))
    js += '};\n\n'

    # Generic haircut fallbacks used by HairType
    fb_path = CC + 'HaircutFallbacks.json'
    fallbacks = json.load(open(fb_path)) if os.path.exists(fb_path) else {}
    js += 'const HAIRCUT_FALLBACKS = %s;\n\n' % json.dumps(fallbacks, indent=2)

    # Default skin tone (AvatarPresets.json uses "Muscular.15")
    js += 'const DEFAULT_SKIN_TONE = "15";\n\n'

    js += 'const CATALOG_TABS = [\n'
    for key, label, icon, group, gamekey in tabs:
        js += ('  { id: %s, label: %s, icon: %s, group: %s, gameKey: %s,'
               ' langKey: %s },\n') % (
            json.dumps(key), json.dumps(label), json.dumps(icon),
            json.dumps(group), json.dumps(gamekey), json.dumps(icon))
    js += '];\n'

    open('catalog.js', 'w').write(js)

    print(f"{'CATEGORY':16}{'items':>7}{'skipped':>11}")
    print('-' * 34)
    total = 0
    for key, n, sk, note in stats:
        total += n
        print(f'{key:16}{n:>7}{sk:>11}  {note}')
    print('-' * 34)
    print(f'{"TOTAL":16}{total:>7}')


if __name__ == '__main__':
    main()
