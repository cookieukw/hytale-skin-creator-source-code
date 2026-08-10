"""Generates i18n.js containing menu strings extracted from game assets.

Keys originate from Shared/Language/<locale>/client.lang, so labels match
official Hytale UI. Cosmetic names are derived from asset IDs.

Usage:  python3 tools/gen_i18n.py
"""
import json
import os
import re

LANG_DIR = ('/home/cookie/.var/app/com.hypixel.HytaleLauncher/data/Hytale/'
            'install/pre-release/package/game/latest/Client/Data/Shared/Language')

LOCALES = [('en-US', 'English'), ('pt-BR', 'Português')]

# App internal key -> client.lang key
FROM_GAME = {
    'title': 'myAvatar.title',
    'color': 'myAvatar.color',
    'search': 'general.searchField.placeholder',
    'reset': 'myAvatar.button.resetOptions',
    'randomize': 'myAvatar.button.randomize',
    'cameraHead': 'myAvatar.tabs.Head',
    'cameraBody': 'myAvatar.tabs.Torso',
}

# Custom app strings not present in the base game files
OURS = {
    'pt-BR': {'none': 'Nenhum', 'import': 'Importar', 'copy': 'Copiar JSON',
              'items': 'itens', 'language': 'Idioma',
              'importPrompt': 'Cole o JSON da skin\n'
                              '(UserData/CachedPlayerSkins/<uuid>.json do Hytale)',
              'importBad': 'JSON inválido: ', 'importMissing': 'Importado, mas não reconheci:\n',
              'copied': 'JSON copiado para a área de transferência',
              'disclaimer': 'Não é um produto oficial. Não somos afiliados ou endossados pela Hypixel Studios.'},
    'en-US': {'none': 'None', 'import': 'Import', 'copy': 'Copy JSON',
              'items': 'items', 'language': 'Language',
              'importPrompt': 'Paste the skin JSON\n'
                              "(Hytale's UserData/CachedPlayerSkins/<uuid>.json)",
              'importBad': 'Invalid JSON: ', 'importMissing': "Imported, but couldn't match:\n",
              'copied': 'JSON copied to clipboard',
              'disclaimer': 'Not an official product. Not affiliated with or endorsed by Hypixel Studios.'},
}


def read_lang(path):
    """Reads a .lang file in `key = value` format, ignoring comments."""
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#') or line.endswith('\\'):
            continue
        m = re.match(r'^([\w.]+)\s*=\s*(.*)$', line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def main():
    bundles = {}
    missing_keys = []

    for code, _ in LOCALES:
        game = read_lang(os.path.join(LANG_DIR, code, 'client.lang'))
        b = dict(OURS.get(code, {}))

        for ours, theirs in FROM_GAME.items():
            if theirs in game:
                b[ours] = game[theirs]
            else:
                missing_keys.append(f'{code}: {theirs}')

        # Tab / group labels: myAvatar.tabs.<Key>
        tabs = {}
        for key, val in game.items():
            if key.startswith('myAvatar.tabs.'):
                tabs[key[len('myAvatar.tabs.'):]] = val
        b['tabs'] = tabs
        bundles[code] = b

    js = ('// GENERATED from Client/Data/Shared/Language/<locale>/client.lang\n'
          '// To regenerate: python3 tools/gen_i18n.py\n'
          'const I18N_LOCALES = %s;\n\n'
          'const I18N = %s;\n' % (
              json.dumps([{'code': c, 'label': l} for c, l in LOCALES],
                         ensure_ascii=False, indent=2),
              json.dumps(bundles, ensure_ascii=False, indent=2)))
    open('i18n.js', 'w', encoding='utf-8').write(js)

    for code, _ in LOCALES:
        print(f'{code}: {len(bundles[code]["tabs"])} tabs + '
              f'{len(bundles[code]) - 1} strings')
    if missing_keys:
        print('\nmissing keys in game:')
        for f in missing_keys:
            print('  ', f)


if __name__ == '__main__':
    main()
