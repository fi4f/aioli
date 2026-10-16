; Theme data. Import this record, copy it, and override any values for your own UI.
(let theme (dict
  "background" (vec4 0.153 0.157 0.133 1)
  "surface" (vec4 0.122 0.125 0.106 1)
  "raised" (vec4 0.20 0.204 0.173 1)
  "foreground" (vec4 0.973 0.973 0.949 1)
  "muted" (vec4 0.459 0.443 0.369 1)
  "green" (vec4 0.651 0.886 0.180 1)
  "pink" (vec4 0.976 0.149 0.447 1)
  "orange" (vec4 0.992 0.592 0.122 1)
  "purple" (vec4 0.682 0.506 1 1)
  "cyan" (vec4 0.4 0.851 0.937 1)
  "border" (vec4 0.286 0.282 0.243 1)
  "font" "monospace"
  "size" 13
  "code-size" 14
  "heading-size" 18
  "small-size" 12
  "text-padding" 4
  "bar-padding" 6
  "line-height" 21
  "border-width" 2
  "icon-size" 16
  "reload-delay" 0.4
  "save-delay" 0.4
  "inspect-delay" 0.25
  "viewport-overscan" 2
  "preview-checker-size" 12
  "preview-checker-light" (vec4 0.34 0.34 0.34 1)
  "preview-checker-dark" (vec4 0.24 0.24 0.24 1)
  "raster-width-step" 256
  "raster-row-step" 8
  "metrics-probe-count" 100
  "selection" (vec4 0.4 0.851 0.937 0.24)
  "icons" (dict)))
(set theme.palette (dict
  "plain" theme.foreground.xyz "punctuation" theme.muted.xyz "keyword" theme.pink.xyz "type" theme.cyan.xyz
  "builtin" theme.cyan.xyz "function" theme.green.xyz "operator" theme.pink.xyz "literal" theme.purple.xyz
  "number" theme.purple.xyz "string" (vec3 0.902 0.859 0.455) "comment" theme.muted.xyz))
(set theme.gutter theme.muted.xyz)
(for name (list "handle" "x" "_" "code" "generator" "command" "file" "main" "play"
  "chevron-d" "chevron-l" "chevron-r" "folder" "image")
  (put theme.icons name (source-url $"./icons/{name}.png")))

; Component defaults. Explicit configuration on a node takes precedence.
(set theme.text (dict "font" theme.font "color" theme.foreground))
(set theme.components (dict
  "label" (dict "size" theme.size)
  "icon" (dict "size" theme.icon-size "color" theme.foreground)
  "button" (dict "background" theme.raised "hover" theme.border "pressed" theme.surface
    "disabled-background" theme.surface "focus-color" theme.green "border-width" theme.border-width)
  "textbox" (dict "size" theme.size "background" theme.surface "selection-color" theme.selection
    "focus-color" theme.green "border-width" theme.border-width)
  "scroll" (dict "scrollbar-track" theme.surface "scrollbar-color" theme.muted "scrollbar-active-color" theme.cyan)
  "pane" (dict "background" theme.background "border-width" theme.border-width
    "border-color" theme.border "border-hover-color" theme.cyan "border-active-color" theme.green)
  "pane-header" (dict "background" theme.raised)
  "popup" (dict "background" theme.surface)
  "dock" (dict "divider" 0 "dwell" 0.6 "dwell-delay" 0.15 "dwell-decay" 0.2 "hold-radius" 6
    "drag-threshold" 6 "undock-shrink" 32 "undock-shrink-bottom" 64
    "background" theme.surface "divider-color" theme.border "divider-hover-color" theme.cyan
    "preview-outline" theme.cyan "preview-fill" (vec4 theme.cyan.xyz 0.25)
    "preview-ready" (vec4 theme.green.xyz 0.3) "preview-ready-outline" theme.green)
  "strip" (dict "background" theme.surface "scroll-indicator-color" theme.foreground "scroll-indicator-size" theme.icon-size)
  "taskbar" (dict "background" theme.surface "scroll-indicator-color" theme.foreground "scroll-indicator-size" theme.icon-size
    "item-style" (dict "font" theme.font "size" theme.size "color" theme.foreground
      "background" theme.raised "hover" theme.border "pressed" theme.surface "focus-color" theme.green "border-width" theme.border-width))))
