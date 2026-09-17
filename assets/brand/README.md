# Locked AI English Companion identity

`brand-glyph-app.svg` is the App Icon optical master. Its four cubic curves
come directly from the final supplied SVG's 288px ceramic artwork (center
282.25,2338.05; bounds 214.497,2257.41–350.003,2418.69), normalized to a
512px body. The reviewed optical mass is retained; no additional 8% enlargement
is applied to this already-final path. Symbol bounds are 240.899556 × 286.72,
giving a vertical/horizontal ratio of 1.1902 and exactly 56% body height.
The source artwork's centered axes are retained without an arbitrary offset.

The star uses the approved single-hue `#8B7CFF` → `#5B4BE0` diagonal (135°).
`#6B5FED` is the base brand purple and the 9% edge-separation color. Ceramic
uses `#FBFAFF` → `#F2F0FB` vertically. The generator places an 864px ceramic
body in a transparent 1024px canvas, preserving the source container's corner
proportion and adding only a low-opacity neutral drop shadow. No glow, white
halo, text, extra sparkle, or secondary accent hue is included.

`brand-glyph-menubar-template.svg` is a separate 16px monochrome optical
master with a stronger center and inward cubic curves. It has no background,
gradient, shadow, or stroke. Its 16/32px PNGs are embedded into generated
`electron/permissions/menuBarIconData.ts`, preserving the established PNG
buffer and 2x representation architecture. `createMenuBarIcon()` still sets
`setTemplateImage(true)` so macOS handles light/dark appearances.

The existing UI optical master remains in `src/selection-action/SelectionActionButton.tsx`
and `src/popover/components/Icons.tsx`. Neither UI path was changed.

Run `npm run generate:brand` on macOS to regenerate PNGs, composed SVG, ICNS
and the embedded tray data. The normal `npm run build` runs this first. Only
the two SVG glyph masters contain manually maintained symbol geometry; the
composed SVG, rasters and tray data are generated. ICNS intermediates are
temporary and are removed after `iconutil` completes.

`electron-builder.yml` uses `generated/app-icon.icns` for the packaged bundle
icon (Finder/Applications/About metadata) and includes the generated tray
module. Development sets the Dock icon from `generated/app-icon.png`.
The packaged product retains its existing accessory activation policy and
normally does not appear in the Dock; this icon change does not alter that
behavior. The default Electron icon is no longer the packaged App Icon.

Size QA: `generated/app-icon-512.png`, `app-icon-128.png`, `app-icon-64.png`,
`app-icon-32.png`, and `menuBarTemplate.png` (16px); Retina tray is
`menuBarTemplate@2x.png`. Generated assets are checked in for direct resource
availability and regenerate from the SVG masters during builds.
