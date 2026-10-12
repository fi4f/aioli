; An ordinary UI component: native text input is the only host service.
; Text, highlighting, selection, caret, scrolling, and hit testing are Lisp.
(let Ui (await (import "../hg/ui.lisp")))

(let __palette__ (dict
  "plain" (vec3 0.82 0.86 0.92) "punctuation" (vec3 0.48 0.55 0.65)
  "keyword" (vec3 0.78 0.62 1) "type" (vec3 0.38 0.79 0.86)
  "builtin" (vec3 0.48 0.72 1) "function" (vec3 0.94 0.79 0.52)
  "operator" (vec3 0.72 0.78 0.88) "literal" (vec3 0.96 0.66 0.49)
  "number" (vec3 0.96 0.66 0.49) "string" (vec3 0.63 0.82 0.52)
  "comment" (vec3 0.46 0.55 0.62)))

(let __source-image__ (sh (image:texture2d position:vec2 clip:vec4
  selections:many<vec2> caret:vec4 line-height:f32 background:vec4)
  (let color (vec4))
  (if (and (>= xy.x clip.x) (< xy.x (+ clip.x clip.z))
    (>= xy.y clip.y) (< xy.y (+ clip.y clip.w))) {
    (set color background)
    (let p (- xy position))
    (let row (i32 (/ p.y line-height)))
    (if (and (>= row 0:i) (< row (i32 (len selections)))) {
      (let selection (get selections.(get row)))
      (if (and (>= p.x selection.x) (< p.x selection.y))
        (set color (blend (vec4 0.2 0.4 0.7 0.65) color)))
    })
    (if (and (>= p.x 0) (< p.x image.w) (>= p.y 0) (< p.y image.h))
      (set color (blend (sample image (/ p image.wh)) color)))
    (if (and (>= xy.x caret.x) (< xy.x (+ caret.x caret.z))
      (>= xy.y caret.y) (< xy.y (+ caret.y caret.w)))
      (set color (blend (vec4 0.9 0.95 1 1) color)))
  })
  color))

(let __reveal__ (fn (node)
  (let model node.props.model)
  (let lines node.state.document.lines)
  (let low 0)
  (let high (- (len lines) 1))
  (let row 0)
  (while (<= low high) {
    (let middle (i32 (/ (+ low high) 2)))
    (let current (get lines.(get middle)))
    (if (< model.head current.start) (set high (- middle 1))
      elif (> model.head current.end) (set low (+ middle 1))
      else { (set row middle) (break) })
  })
  (if (< row model.scroll) (set model.scroll row))
  (if (> (+ row 1) (+ model.scroll (or node.state.rows 1)))
    (set model.scroll (max 0 (- (+ row 1) (or node.state.rows 1)))))))

(let __accept__ (fn (ui node edit)
  (let model node.props.model)
  (let changed (not (= model.source edit.content)))
  (let reveal (or changed (not (= model.anchor edit.anchor)) (not (= model.head edit.head))))
  (set node.state.document edit)
  (set model.source edit.content)
  (set model.anchor edit.anchor)
  (set model.head edit.head)
  (set model.composing edit.composing)
  (if changed {
    (set model.version (+ model.version 1))
    (Ui.ui-event ui node "change" (dict "model" model))
  })
  (if reveal (__reveal__ node))
  (Ui.ui-repaint ui)))

(let __metrics__ (fn (ui node)
  (let key (list node.props.size ui.scale))
  (if (not (= key node.state.metrics-key)) {
    (let wide (text (font "monospace") (size (* node.props.size ui.scale)) (for i 100 "M")))
    (let narrow (text (font "monospace") (size (* node.props.size ui.scale)) "M"))
    (set node.state.cell (/ (- wide.w narrow.w) (* 99 ui.scale)))
    (set node.state.metrics-key key)
  })))

(let __mount__ (fn (ui node)
  (let model node.props.model)
  (set node.state.proxy (text-proxy (fn (edit) (__accept__ ui node edit))))
  (TextProxy.sync node.state.proxy model.source model.anchor model.head)
  (set node.state.document (TextProxy.snapshot node.state.proxy))
  (set model.source node.state.document.content)
  (__metrics__ ui node)))

(let __unmount__ (fn (ui node)
  (if node.state.proxy (TextProxy.dispose node.state.proxy))
  (set node.state.selecting false)
  (set node.state.proxy nil)))

(let __measure__ (fn (ui node)
  (__metrics__ ui node)
  (let model node.props.model)
  (if (and node.state.proxy (not (= node.state.document.content model.source))) {
    (set model.anchor (clamp model.anchor 0 (len model.source)))
    (set model.head (clamp model.head 0 (len model.source)))
    (TextProxy.sync node.state.proxy model.source model.anchor model.head)
    (set node.state.document (TextProxy.snapshot node.state.proxy))
    (Ui.ui-invalidate ui)
  })
  (let key (list model.source model.anchor model.head model.scroll node.state.focused
    ui.scale node.props.size node.props.line-height))
  (if (not (= key node.state.paint-key)) {
    (set node.state.paint-key key)
    (Ui.ui-invalidate ui)
  })
  (vec2 220 100)))

(let __arrange__ (fn (ui node)
  (set node.state.rows (/ node.bounds.w node.props.line-height))
  (set node.props.model.scroll (clamp node.props.model.scroll 0
    (max 0 (- (len node.state.document.lines) node.state.rows))))))

(let __event__ (fn (ui node name event)
  (if (= name "focus") (TextProxy.focus node.state.proxy))
  (if (= name "blur") (TextProxy.blur node.state.proxy))
  (if (or (= name "pointerdown")
    (and (= name "pointermove") node.state.selecting (> event.buttons 0))) {
    (if (= name "pointerdown") (set node.state.selecting true))
    (let column (i32 (max 0 (+ 0.5 (/ (- event.x node.bounds.x
      (or node.state.gutter 0)) node.state.cell)))))
    (let row (i32 (+ node.props.model.scroll (/ (- event.y node.bounds.y) node.props.line-height))))
    (TextProxy.select node.state.proxy row column
      (or event.shift (= name "pointermove")))
    (TextProxy.focus node.state.proxy)
    (set event.stop true)
  })
  (if (or (= name "pointerup") (= name "pointercancel")) (set node.state.selecting false))
  (if (= name "wheel") {
    (let delta (/ event.dy node.props.line-height))
    (if (= event.mode 1) (set delta event.dy))
    (if (= event.mode 2) (set delta (* event.dy node.state.rows)))
    (set node.props.model.scroll (clamp (+ node.props.model.scroll delta) 0
      (max 0 (- (len node.state.document.lines) node.state.rows))))
    (set event.prevent-default true)
    (set event.stop true)
    (Ui.ui-repaint ui)
  })))

(let __paint__ (fn (ui node context)
  (let model node.props.model)
  (let document node.state.document)
  (let line-height node.props.line-height)
  (let visible (+ (i32 node.state.rows) 2))
  (let first-row (i32 model.scroll))
  (let fraction (- model.scroll first-row))
  (if (not (= node.state.token-source model.source)) {
    (set node.state.tokens (App.tokenize app model.source))
    (set node.state.token-source model.source)
  })
  (let digits 1)
  (let remaining (len document.lines))
  (while (>= remaining 10) { (set remaining (i32 (/ remaining 10))) (set digits (+ digits 1)) })
  (set node.state.gutter (* (+ digits 2) node.state.cell))
  ; Unwrapped text does not reflow when a pane shrinks. Retain spare raster space
  ; so undocking and small resize steps only change the clip, not every glyph.
  (let needed-width (* (max 1 node.bounds.z) ui.scale))
  (let bucket-width (min (max needed-width context.w)
    (* 256 (+ (i32 (/ needed-width 256)) 1))))
  (set node.state.image-width (max (or node.state.image-width 0) bucket-width))
  (let bucket-rows (min (len document.lines) (* 8 (+ (i32 (/ visible 8)) 1))))
  (set node.state.image-rows (max (or node.state.image-rows 0) bucket-rows))
  (let key (list model.source first-row node.state.image-width node.state.image-rows node.props.size
    line-height ui.scale))
  (if (not (= node.state.image-key key)) {
    (set node.state.image (text (font "monospace") (size (* node.props.size ui.scale)) (wrap false)
      (width node.state.image-width) (height (* node.state.image-rows line-height ui.scale))
      (line-height (* line-height ui.scale))
      (for index node.state.image-rows {
        (let row (+ first-row index))
        (if (>= row (len document.lines)) (break))
        (let number (+ row 1))
        (let number-digits 1)
        (let rest number)
        (while (>= rest 10) { (set rest (i32 (/ rest 10))) (set number-digits (+ number-digits 1)) })
        (fill (vec3 0.38 0.45 0.54))
        (for pad (- digits number-digits) " ")
        (span (str number))
        "  "
        (for token (get node.state.tokens.(get row)) {
          (fill (or (get __palette__.(get token.kind)) __palette__.plain))
          (span token.text)
        })
        (line)
      })))
    (set node.state.image-key key)
  })
  ; Selection buffers depend on the document/scroll, not the pane's screen position.
  (let selection-key (list model.source model.anchor model.head model.scroll
    visible node.state.gutter node.state.cell ui.scale))
  (if (not (= node.state.selection-key selection-key)) {
    (let selections (many (vec2)))
    (for index visible {
      (let row (+ first-row index))
      (if (>= row (len document.lines)) (break))
      (let current (get document.lines.(get row)))
      (insert selections (vec2
        (* (+ node.state.gutter (* current.selection-start node.state.cell)) ui.scale)
        (* (+ node.state.gutter (* current.selection-end node.state.cell)) ui.scale)))
    })
    (set node.state.selections selections)
    (set node.state.selection-key selection-key)
  })
  (let caret (vec4))
  (if node.state.focused (for index visible {
    (let row (+ first-row index))
    (if (>= row (len document.lines)) (break))
    (let current (get document.lines.(get row)))
    (if (>= current.caret 0) {
      (let position (vec2 (+ node.bounds.x node.state.gutter (* current.caret node.state.cell))
        (+ node.bounds.y (* (- index fraction) line-height))))
      (set caret (vec4 (Ui.ui-pixel-position (* position ui.scale)) ui.scale (* line-height ui.scale)))
      (TextProxy.caret node.state.proxy
        (Ui.ui-pixel-position (* (vec2 position.x (max node.clip.y position.y)) ui.scale))
        (* line-height ui.scale))
      (break)
    })
  }))
  (layer context (* node.clip ui.scale) __source-image__ node.state.image.texture
    (Ui.ui-pixel-position (* (vec2 node.bounds.x (- node.bounds.y (* fraction line-height))) ui.scale))
    (* node.clip ui.scale) node.state.selections caret (* line-height ui.scale) node.props.background)))

(let code-editor-component (dict "mount" __mount__ "unmount" __unmount__
  "measure" __measure__ "arrange" __arrange__ "paint" __paint__ "event" __event__))

(let code-editor (fn (model &rest options)
  (Ui.ui-node code-editor-component (dict "model" (model : dict) "grow" 1 "focusable" true
    "cursor" "text"
    "size" 14 "line-height" 20 "background" (vec4 0.08 0.09 0.12 1)) options)))
