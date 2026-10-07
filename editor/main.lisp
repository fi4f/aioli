; Welcome to Mayo. This is the source of the editor you are using right now.
; Change the title, palette, or background below, then pause to reload it.
;
; Aioli supplies execution and invisible browser input. Everything you can see
; here (source, line numbers, selection, caret, and errors) is drawn with WebGPU.

; Shared document state survives replacement of this script. GPU textures and
; the text proxy belong to the current scene and are recreated after a reload.
(let state aioli.state)
(if (= state.source nil) {
  (set state.source aioli.source)
  (set state.anchor 0)
  (set state.head 0)
  (set state.scroll 0)
  (set state.error "")
})
(let title "Mayo")

; Native input is mirrored into a Lisp snapshot; it never paints the editor.
(let proxy nil)
(let document nil)
(let pending false)
(let elapsed 0)
(let version 0)
(let composing false)

; Use existing text measurements to estimate a monospace cell. Exact caret
; geometry remains a future text API discussion; this works for basic source.
(let probe (text (font "monospace") (size 14) (for i 100 "M")))
(let single (text (font "monospace") (size 14) "M"))
(let cell (/ (- probe.w single.w) 99))
(let line-height 20)
(let top 64)
(let visible 30)
(let rows-in-view 30)
(let gutter-columns 3)
(let gutter-width (* gutter-columns cell))

; These caches separate document changes from selection and sub-line scrolling.
; Tokenize only when source changes; rebuild the viewport texture when its
; first row or dimensions change. An unchanged frame preserves the GPU image.
(let drawn-source nil)
(let drawn-anchor nil)
(let drawn-head nil)
(let drawn-scroll nil)
(let drawn-error nil)
(let drawn-width 0)
(let drawn-height 0)
(let source-image nil)
(let image-source nil)
(let image-scroll nil)
(let image-width 0)
(let image-height 0)
(let token-source nil)
(let tokens (list))

; Syntax categories come from the compiler's shared, tolerant lexer. Colors
; and all presentation policy stay here in Lisp, so you can edit the theme.
(let palette (dict
  "plain"       (vec3 0.82 0.86 0.92)
  "punctuation" (vec3 0.48 0.55 0.65)
  "keyword"     (vec3 0.78 0.62 1.00)
  "type"        (vec3 0.38 0.79 0.86)
  "builtin"     (vec3 0.48 0.72 1.00)
  "function"    (vec3 0.94 0.79 0.52)
  "operator"    (vec3 0.72 0.78 0.88)
  "literal"     (vec3 0.96 0.66 0.49)
  "number"      (vec3 0.96 0.66 0.49)
  "string"      (vec3 0.63 0.82 0.52)
  "comment"     (vec3 0.46 0.55 0.62)))

; Header labels are static within a scene. They do not need rebuilding on edits.
(let heading (text (size 24) (span title)))
(let hint (text
  (size 12)
  "Editing editor/main.lisp · changes reload after 400 ms"))

; Selection-only events update the caret without scheduling a source reload.
; Reveal the caret only for an actual document/selection change, allowing the
; user to scroll elsewhere without composition notifications pulling it back.
(let accept (fn (edit)
  (let reveal (or (not (= state.source edit.content))
    (not (= state.anchor edit.anchor)) (not (= state.head edit.head))))
  (if (not (= state.source edit.content)) {
    (set state.source edit.content)
    (set pending true)
    (set elapsed 0)
    (set version (+ version 1))
  })
  (set state.anchor edit.anchor)
  (set state.head edit.head)
  (set composing edit.composing)
  (set document edit)
  (let row 0)
  (for line edit.lines {
    (if (and reveal (>= line.caret 0)) {
      (if (< row state.scroll) (set state.scroll row))
      (if (> (+ row 1) (+ state.scroll rows-in-view))
        (set state.scroll (max 0 (- (+ row 1) rows-in-view))))
    })
    (set row (+ row 1))
  })))

; The proxy supplies keyboard editing and IME. Lisp keeps the canonical draft.
(on attach ()
  (set proxy (text-proxy accept))
  (proxy.sync state.source state.anchor state.head)
  (set document (proxy.snapshot))
  (set state.source document.content)
  (proxy.focus))
(on detach () (proxy.dispose))

; Debounce is ordinary Lisp update logic. Never replace a scene during IME
; composition. A failed traced reload leaves this editor available to correct it.
(on update (context)
  (if (and pending (not composing)) {
    (set elapsed (+ elapsed context.dt))
    (if (>= elapsed 0.4) {
      (set pending false)
      (set state.error "")
      (let requested version)
      (async (aioli.reload state.source)
        catch (error) {
          (if (= version requested) (set state.error error.message))
        })
    })
  }))

; Map pointer coordinates into rows and columns, accounting for fractional
; scrolling and the line-number gutter. Shift and dragging extend selection.
(on pointerdown (event)
  (if (>= event.y top) {
    (proxy.select (i32 (+ state.scroll (/ (- event.y top) line-height)))
      (i32 (max 0 (+ 0.5 (/ (- event.x 24 gutter-width) cell)))) event.shift)
    (proxy.focus)
  }))
; Retain small wheel deltas rather than truncating them to whole lines.
; Browser wheel units may be pixels, lines, or pages; normalize each to rows.
(on wheel (event)
  (let delta (/ event.dy line-height))
  (if (= event.mode 1) (set delta event.dy))
  (if (= event.mode 2) (set delta (* event.dy rows-in-view)))
  (set state.scroll (clamp (+ state.scroll delta)
    0 (max 0 (- (len document.lines) rows-in-view)))))
(on pointermove (event)
  (if (and (> event.buttons 0) (>= event.y top)) {
    (proxy.select (i32 (+ state.scroll (/ (- event.y top) line-height)))
      (i32 (max 0 (+ 0.5 (/ (- event.x 24 gutter-width) cell)))) true)
    (proxy.focus)
  }))

; Reusable GPU composition helpers. Each shader is compiled once for a scene.
(let draw-text (sh (label:texture2d position:vec2 clip:vec2)
  (let p (- xy position))
  (if (and (>= xy.y clip.x) (< xy.y clip.y)
    (>= p.x 0) (< p.x label.w) (>= p.y 0) (< p.y label.h))
    (return (blend (sample label (/ p label.wh)))))
  (return (sample before uv))))
(let rectangle (sh (position:vec2 dimensions:vec2 color:vec4 clip:vec2)
  (let p (- xy position))
  (if (and (>= xy.y clip.x) (< xy.y clip.y)
    (>= p.x 0) (< p.x dimensions.x) (>= p.y 0) (< p.y dimensions.y))
    (return (blend color)))
  (return (sample before uv))))
; Selection goes behind the glyphs; the caret goes over them. Line ranges are
; packed into one small buffer, and each pixel looks up only its own row.
(let draw-source (sh (label:texture2d position:vec2 clip:vec2
  selections:many<vec2> caret:vec4 line-step:f32)
  (let p (- xy position))
  (let color (sample before uv))
  (if (and (>= xy.y clip.x) (< xy.y clip.y)
    (>= p.x 0) (< p.x label.w) (>= p.y 0) (< p.y label.h)) {
    (let selected (get selections (i32 (/ p.y line-step))))
    (if (and (>= p.x selected.x) (< p.x selected.y))
      (set color (blend (vec4 0.2 0.4 0.7 0.7) color)))
    (set color (blend (sample label (/ p label.wh)) color))
    (let c (- xy caret.xy))
    (if (and (>= c.x 0) (< c.x caret.z) (>= c.y 0) (< c.y caret.w))
      (set color (blend (vec4 0.9 0.95 1 1) color)))
  })
  (return color)))

; Drawing is demand-driven even though Stage continues to update the debounce.
(on render (context)
  (set rows-in-view (/ (max line-height (- context.h top 100)) line-height))
  (set state.scroll (clamp state.scroll 0 (max 0 (- (len document.lines) rows-in-view))))
  ; Preserve the completed GPU image while the editor is unchanged.
  (if (and (= drawn-source state.source) (= drawn-anchor state.anchor)
    (= drawn-head state.head) (= drawn-scroll state.scroll) (= drawn-error state.error)
    (= drawn-width context.w) (= drawn-height context.h)) (return))
  (clear 0.08 0.09 0.12)
  (let full-clip (vec2 0 context.h))
  (let source-clip (vec2 top (+ top (* rows-in-view line-height))))
  (draw-text context heading.texture (vec2 24 16) full-clip)
  (draw-text context hint.texture (vec2 130 24) full-clip)
  (set visible (+ (i32 rows-in-view) 2))
  (let first-row (i32 state.scroll))
  (let fraction (- state.scroll first-row))
  (if (not (= token-source state.source)) {
    (set tokens (aioli.tokenize state.source))
    (set token-source state.source)
  })

  ; Fit the gutter to the number of digits in the document's final line number.
  (let digits 1)
  (let remaining (len document.lines))
  (while (>= remaining 10) {
    (set remaining (i32 (/ remaining 10)))
    (set digits (+ digits 1))
  })
  (set gutter-columns (+ digits 2))
  (set gutter-width (* gutter-columns cell))

  ; Batch only visible rows. Fixed dimensions and wrap=false clip long lines
  ; without shifting subsequent rows; styled spans retain their exact text.
  (if (or (not (= image-source state.source)) (not (= image-scroll first-row))
    (not (= image-width context.w)) (not (= image-height context.h))) {
    (set source-image (text (font "monospace") (size 14)
      (width (max 1 (- context.w 48))) (height (* visible line-height))
      (line-height line-height) (wrap false)
      (for index visible {
        (let row (+ first-row index))
        (if (>= row (len document.lines)) (break))
        (let number (+ row 1))
        (let number-digits 1)
        (let rest number)
        (while (>= rest 10) {
          (set rest (i32 (/ rest 10)))
          (set number-digits (+ number-digits 1))
        })
        (fill (vec3 0.38 0.45 0.54))
        (for pad (- digits number-digits) " ")
        (span (str number))
        "  "
        (for token (get tokens row) {
          (fill (or (get palette token.kind) palette.plain))
          (span token.text)
        })
        (line)
      })))
    (set image-source state.source)
    (set image-scroll first-row)
    (set image-width context.w)
    (set image-height context.h)
  })
  (let selections (many (vec2)))
  (let caret (vec4 0))
  (for index visible {
    (let row (+ first-row index))
    (if (>= row (len document.lines)) (break))
    (let line (get document.lines row))
    (let y (+ top (* (- index fraction) line-height)))
    (insert selections (vec2 (+ gutter-width (* line.selection-start cell))
      (+ gutter-width (* line.selection-end cell))))
    (if (>= line.caret 0) {
      (let position (vec2 (+ 24 gutter-width (* line.caret cell)) y))
      (set caret (vec4 position 1 line-height))
      (proxy.caret (vec2 position.x (max top position.y)) line-height)
    })
  })
  ; Source, selection backgrounds, and caret compose in one GPU pass.
  (draw-source context source-image.texture (vec2 24 (- top (* fraction line-height)))
    source-clip selections caret line-height)
  ; Trace excerpts require monospace and no wrapping for their ^ markers.
  (rectangle context
    (vec2 0 (- context.h 90))
    (vec2 context.w 90)
    (vec4 0.06 0.07 0.09 1)
    full-clip)
  (draw-text context (text (font "monospace") (size 13) (wrap false)
    (width (max 1 (- context.w 48))) (height 76)
    (fill 1 0.65 0.6) (span state.error)).texture (vec2 24 (- context.h 82)) full-clip)
  (set drawn-source state.source)
  (set drawn-anchor state.anchor)
  (set drawn-head state.head)
  (set drawn-scroll state.scroll)
  (set drawn-error state.error)
  (set drawn-width context.w)
  (set drawn-height context.h))
