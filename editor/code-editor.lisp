; An ordinary UI component: native text input is the only host service.
; Text, highlighting, selection, caret, scrolling, and hit testing are Lisp.
(let Ui (await (import "../hg/ui.lisp")))

(let Theme Ui.ui-theme-data)
(let __palette__ Theme.palette)

(let __source-image__ (sh (image:texture2d gutter-image:texture2d position:vec2 clip:vec4 gutter:f32 scroll:f32
  selections:many<vec2> caret:vec4 line-height:f32 background:vec4 selection-color:vec4 caret-color:vec4)
  (let color (vec4))
  (if (and (>= xy.x clip.x) (< xy.x (+ clip.x clip.z))
    (>= xy.y clip.y) (< xy.y (+ clip.y clip.w))) {
    (set color background)
    (let p (- xy position))
    (let code (vec2 (+ (- p.x gutter) scroll) p.y))
    (let row (i32 (/ p.y line-height)))
    (if (and (>= p.x gutter) (>= row 0:i) (< row (i32 (len selections)))) {
      (let selection (get selections.(get row)))
      (if (and (>= code.x selection.x) (< code.x selection.y))
        (set color (blend selection-color color)))
    })
    (if (< p.x gutter) {
      (if (and (>= p.x 0) (< p.x gutter-image.w) (>= p.y 0) (< p.y gutter-image.h))
        (set color (blend (sample gutter-image (/ p gutter-image.wh)) color)))
    } else {
      (if (and (>= code.x 0) (< code.x image.w) (>= code.y 0) (< code.y image.h))
        (set color (blend (sample image (/ code image.wh)) color)))
    })
    (if (and (>= p.x gutter) (>= xy.x caret.x) (< xy.x (+ caret.x caret.z))
      (>= xy.y caret.y) (< xy.y (+ caret.y caret.w)))
      (set color (blend caret-color color)))
  })
  color))

(let __viewport__ (fn (node)
  (let model node.props.model)
  (let digits (len (str (len node.state.document.lines))))
  (set node.state.digits digits)
  (set node.state.gutter (* (+ digits 2) node.state.cell))
  (set node.state.columns-width (max 0 (- node.bounds.z node.state.gutter)))
  (set node.state.max-scroll-x (max 0 (-
    (+ (* node.state.document.max-columns node.state.cell) node.state.cell) node.state.columns-width)))
  (set model.scroll-x (clamp model.scroll-x 0 node.state.max-scroll-x))))

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
    (set model.scroll (max 0 (- (+ row 1) (or node.state.rows 1)))))
  (let current (get lines.(get row)))
  (let x (* (- model.head current.start) node.state.cell))
  (let width (max 1 node.state.columns-width))
  (if (< x model.scroll-x) (set model.scroll-x x))
  (if (> (+ x node.state.cell) (+ model.scroll-x width))
    (set model.scroll-x (- (+ x node.state.cell) width)))
  (set model.scroll-x (clamp model.scroll-x 0 node.state.max-scroll-x))))

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
  (__viewport__ node)
  (if reveal (__reveal__ node))
  (Ui.ui-repaint ui)))

(let __metrics__ (fn (ui node)
  (let key (list node.props.size ui.scale))
  (if (not (= key node.state.metrics-key)) {
    (let wide (text (font Theme.font) (size (* node.props.size ui.scale))
      (for i Theme.metrics-probe-count "M")))
    (let narrow (text (font Theme.font) (size (* node.props.size ui.scale)) "M"))
    (set node.state.cell (/ (- wide.w narrow.w) (* (- Theme.metrics-probe-count 1) ui.scale)))
    (set node.state.metrics-key key)
  })))

(let __mount__ (fn (ui node)
  (let model node.props.model)
  (if (= model.scroll-x nil) (set model.scroll-x 0))
  (set node.state.proxy (text-proxy (fn (edit) (__accept__ ui node edit))))
  (TextProxy.sync node.state.proxy model.source model.anchor model.head)
  (set node.state.document (TextProxy.snapshot node.state.proxy))
  (set model.source node.state.document.content)
  (set node.state.restore-focus (bool model.focused))
  (__metrics__ ui node)))

(let __unmount__ (fn (ui node)
  (if node.state.proxy {
    (if (TextProxy.focused node.state.proxy) {
      (let snapshot (TextProxy.snapshot node.state.proxy))
      (set node.props.model.anchor snapshot.anchor)
      (set node.props.model.head snapshot.head)
    })
    (TextProxy.dispose node.state.proxy)
  })
  (set node.state.selecting false)
  (set node.state.proxy nil)))

(let __measure__ (fn (ui node)
  (__metrics__ ui node)
  (let model node.props.model)
  (if node.state.proxy (TextProxy.readOnly node.state.proxy (bool model.locked)))
  (if (and node.state.proxy (not (= node.state.document.content model.source))) {
    (set model.anchor (clamp model.anchor 0 (len model.source)))
    (set model.head (clamp model.head 0 (len model.source)))
    (TextProxy.sync node.state.proxy model.source model.anchor model.head)
    (set node.state.document (TextProxy.snapshot node.state.proxy))
    (set model.source node.state.document.content)
    (Ui.ui-invalidate ui)
  })
  (let key (list model.source model.anchor model.head model.scroll model.scroll-x node.state.focused
    ui.scale node.props.size node.props.line-height))
  (if (not (= key node.state.paint-key)) {
    (set node.state.paint-key key)
    (Ui.ui-invalidate ui)
  })
  (vec2 220 100)))

(let __arrange__ (fn (ui node)
  (__viewport__ node)
  (set node.state.rows (/ node.bounds.w node.props.line-height))
  (set node.props.model.scroll (clamp node.props.model.scroll 0
    (max 0 (- (len node.state.document.lines) node.state.rows))))
  (if node.state.restore-focus {
    (set node.state.restore-focus false)
    (Ui.ui-focus ui (Ui.ui-path ui.root node))
  })))

(let __event__ (fn (ui node name event)
  (if (= name "focus") {
    (set node.props.model.focused true)
    (TextProxy.focus node.state.proxy)
  })
  (if (= name "blur") {
    (set node.props.model.focused false)
    (TextProxy.blur node.state.proxy)
  })
  (if (or (= name "pointerdown")
    (and (= name "pointermove") node.state.selecting (> event.buttons 0))) {
    (if (= name "pointerdown") (set node.state.selecting true))
    (let left (+ node.bounds.x node.state.gutter))
    (let column (if (< event.x left) 0 (i32 (max 0 (+ 0.5
      (/ (+ (- event.x left) node.props.model.scroll-x) node.state.cell))))))
    (let row (i32 (+ node.props.model.scroll (/ (- event.y node.bounds.y) node.props.line-height))))
    (TextProxy.select node.state.proxy row column
      (or event.shift (= name "pointermove")))
    (TextProxy.focus node.state.proxy)
    (set event.stop true)
  })
  (if (or (= name "pointerup") (= name "pointercancel")) (set node.state.selecting false))
  (if (= name "wheel") {
    (let dx event.dx)
    (let dy event.dy)
    (if event.shift { (if (= dx 0) (set dx dy)) (set dy 0) })
    (let vertical (/ dy node.props.line-height))
    (if (= event.mode 1) { (set dx (* dx node.state.cell)) (set vertical dy) })
    (if (= event.mode 2) {
      (set dx (* dx node.state.columns-width)) (set vertical (* dy node.state.rows))
    })
    (set node.props.model.scroll-x (clamp (+ node.props.model.scroll-x dx) 0 node.state.max-scroll-x))
    (set node.props.model.scroll (clamp (+ node.props.model.scroll vertical) 0
      (max 0 (- (len node.state.document.lines) node.state.rows))))
    (set event.prevent-default true)
    (set event.stop true)
    (Ui.ui-repaint ui)
  })))

(let __paint__ (fn (ui node context)
  (let model node.props.model)
  (let document node.state.document)
  (let line-height node.props.line-height)
  (let visible (+ (i32 node.state.rows) Theme.viewport-overscan))
  (let first-row (i32 model.scroll))
  (let fraction (- model.scroll first-row))
  (if (not (= node.state.token-source model.source)) {
    (set node.state.tokens (App.tokenize app model.source))
    (set node.state.token-source model.source)
  })
  (let digits node.state.digits)
  (let gutter (i32 (+ (* node.state.gutter ui.scale) 0.5)))
  (let scroll (i32 (+ (* model.scroll-x ui.scale) 0.5)))
  ; Shift a bounded raster window in coarse steps; small horizontal scrolls reuse it.
  (let raster-left (* Theme.raster-width-step (i32 (/ scroll Theme.raster-width-step))))
  ; Unwrapped text does not reflow when a pane shrinks. Retain spare raster space
  ; so undocking and small resize steps only change the clip, not every glyph.
  (let needed-width (+ (* (max 1 node.state.columns-width) ui.scale) Theme.raster-width-step))
  (let bucket-width (min (max needed-width (+ context.w Theme.raster-width-step))
    (* Theme.raster-width-step (+ (i32 (/ needed-width Theme.raster-width-step)) 1))))
  (set node.state.image-width (max (or node.state.image-width 0) bucket-width))
  (let bucket-rows (min (len document.lines) (* Theme.raster-row-step
    (+ (i32 (/ visible Theme.raster-row-step)) 1))))
  (set node.state.image-rows (max (or node.state.image-rows 0) bucket-rows))
  (let key (list model.source first-row raster-left node.state.image-width node.state.image-rows node.props.size
    line-height ui.scale))
  (if (not (= node.state.image-key key)) {
    (set node.state.image (text (font Theme.font) (size (* node.props.size ui.scale)) (wrap false)
      (width node.state.image-width) (height (* node.state.image-rows line-height ui.scale))
      (line-height (* line-height ui.scale))
      (offset (vec2 (- raster-left) 0))
      (for index node.state.image-rows {
        (let row (+ first-row index))
        (if (>= row (len document.lines)) (break))
        (for token (get node.state.tokens.(get row)) {
          (fill (or (get __palette__.(get token.kind)) __palette__.plain))
          (span token.text)
        })
        (line)
      })))
    (set node.state.image-key key)
  })
  ; Line numbers use an independent narrow texture and never scroll horizontally.
  (let gutter-key (list first-row (len document.lines) node.state.image-rows digits gutter node.props.size line-height ui.scale))
  (if (not (= node.state.gutter-key gutter-key)) {
    (set node.state.gutter-image (text (font Theme.font) (size (* node.props.size ui.scale)) (wrap false)
      (width (max 1 gutter)) (height (* node.state.image-rows line-height ui.scale))
      (line-height (* line-height ui.scale)) (fill Theme.gutter)
      (for index node.state.image-rows {
        (let row (+ first-row index))
        (if (>= row (len document.lines)) (break))
        (let number (str (+ row 1)))
        (for pad (- digits (len number)) " ")
        (span number)
        (line)
      })))
    (set node.state.gutter-key gutter-key)
  })
  ; Selection buffers depend on the document/scroll, not the pane's screen position.
  (let selection-key (list model.source model.anchor model.head first-row raster-left
    visible node.state.cell ui.scale))
  (if (not (= node.state.selection-key selection-key)) {
    (let selections (many (vec2)))
    (for index visible {
      (let row (+ first-row index))
      (if (>= row (len document.lines)) (break))
      (let current (get document.lines.(get row)))
      (insert selections (vec2
        (- (* current.selection-start node.state.cell ui.scale) raster-left)
        (- (* current.selection-end node.state.cell ui.scale) raster-left)))
    })
    (set node.state.selections selections)
    (set node.state.selection-key selection-key)
  })
  (let origin (Ui.ui-pixel-position (*
    (vec2 node.bounds.x (- node.bounds.y (* fraction line-height))) ui.scale)))
  (let caret (vec4))
  (if node.state.focused (for index visible {
    (let row (+ first-row index))
    (if (>= row (len document.lines)) (break))
    (let current (get document.lines.(get row)))
    (if (>= current.caret 0) {
      (let position (Ui.ui-pixel-position (vec2
        (+ origin.x gutter (- (* current.caret node.state.cell ui.scale) scroll))
        (+ origin.y (* index line-height ui.scale)))))
      (set caret (vec4 position ui.scale (* line-height ui.scale)))
      (TextProxy.caret node.state.proxy
        (vec2 (clamp position.x (max (* node.clip.x ui.scale) (+ origin.x gutter))
          (max (+ origin.x gutter) (- (* (+ node.clip.x node.clip.z) ui.scale) ui.scale)))
          (max (* node.clip.y ui.scale) position.y))
        (* line-height ui.scale))
      (break)
    })
  }))
  (layer context (* node.clip ui.scale) __source-image__ node.state.image.texture node.state.gutter-image.texture
    origin (* node.clip ui.scale) gutter (- scroll raster-left) node.state.selections caret
    (* line-height ui.scale) node.props.background Theme.selection Theme.foreground)))

(let code-editor-component (dict "mount" __mount__ "unmount" __unmount__
  "measure" __measure__ "arrange" __arrange__ "paint" __paint__ "event" __event__))

(let code-editor (fn (model &rest options)
  (Ui.ui-node code-editor-component (dict "model" (model : dict) "grow" 1 "focusable" true
    "cursor" "text"
    "size" Theme.code-size "line-height" Theme.line-height "background" Theme.background) options)))
