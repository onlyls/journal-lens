# Third-party notices

Journal Lens includes the following third-party components in its extension package.

## citeproc-js

- Package: `citeproc` 2.4.63, based on citeproc-js 1.4.63
- Project: https://github.com/Juris-M/citeproc-js
- Copyright: Copyright (c) 2009-2019 Frank Bennett
- License: CPAL-1.0 OR AGPL-1.0
- Included license: `vendor/citeproc/LICENSE`

The JavaScript processor is packaged locally. Journal Lens does not download or execute remote JavaScript.

## Citation Style Language styles and locales

- Styles: https://github.com/citation-style-language/styles, stable branch `v1.0.2`
- Locales: https://github.com/citation-style-language/locales, stable branch `v1.0.2`
- Project: https://citationstyles.org/
- License: Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)

The bundled CSL files retain their original `<info>` metadata, including authors and contributors. Styles and locales downloaded later remain stored as XML data and are not executable code.
