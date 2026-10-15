; Mercury UI is an ordinary Lisp module. Components, layout, painting, and
; interaction policy can all be edited here or replaced through its live exports.
; Component namespaces receive (ui node ...) explicitly; nodes are plain dicts.

(let ui-config (fn (&rest props)
  (dict "kind" "config" "props" (dict (if (= (len props) 1) (get props.0) props)))))
; Compatibility for saved projects. New construction uses individual configuration forms.
(let ui-style ui-config)
(let ui-prop (fn (key value) (ui-config (dict (key : str) value))))
(let padding (fn (value) (Layout.padding value) (ui-prop "padding" value)))
(let gap (fn (value) (ui-prop "gap" (max 0 (value : num)))))
(let grow (fn (value) (ui-prop "grow" (max 0 (value : num)))))
(let width (fn (value) (ui-prop "w" (max 0 (value : num)))))
(let height (fn (value) (ui-prop "h" (max 0 (value : num)))))
(let font (fn (value) (ui-prop "font" (value : str))))
(let size (fn (value) (ui-prop "size" (max 0.01 (value : num)))))
(let fill (fn (&rest channels) (ui-prop "color" (Colors.rgba channels))))
(let h-align (fn (value) (ui-prop "h-align" (value : str))))
(let v-align (fn (value) (ui-prop "v-align" (value : str))))
(let align (fn (value) (ui-config "h-align" (value : str) "v-align" value)))
(let background (fn (value) (ui-prop "background" (value : vec4))))
(let visible (fn (value) (ui-prop "visible" (value : bool))))
(let disabled (fn (value) (ui-prop "disabled" (value : bool))))

; The value-position (on ...) form calls this ordinary, editable function.
(let ui-on (fn (name handler)
  (dict "kind" "handler" "name" (name : str) "handler" (handler : function))))

(let __ui-input-names__ (list "pointerdown" "pointermove" "pointerup" "pointercancel"
  "pointerleave" "wheel" "keydown" "keyup"))

(let __ui-options__ (fn (node items)
  (for item items {
    (if (or (= item nil) (= item false)) (continue))
    (if (list? item) { (__ui-options__ node item) (continue) })
    (if (str? item) { (insert node.children (ui-label item)) (continue) })
    (if (or (= item.kind "config") (= item.kind "style")) {
      (for key (keys item.props) {
        (put node.props key (get item.props.(get key)))
        (put node.state.configured key true)
      })
    } elif (= item.kind "handler") {
      (let handlers (get node.handlers.(get item.name)))
      (if (= handlers nil) {
        (set handlers (list))
        (put node.handlers item.name handlers)
      })
      (insert handlers item.handler)
    } elif (= item.kind "node") {
      (insert node.children item)
    })
  })
  node))

(let ui-node (fn (component props &rest items)
  ; A string starts property pairs; subsequent component items keep their order.
  (if (str? props) {
    (let entries (list props (get items.0)))
    (let index 1)
    (while (< index (len items)) {
      (let key (get items.(get index)))
      (if (or (dict? key) (list? key) (= key nil) (= key false)) (break))
      (insert entries key)
      (insert entries (get items.(+ index 1)))
      (set index (+ index 2))
    })
    (set props (dict entries))
    (let remaining (list))
    (for i (len items) (if (>= i index) (insert remaining (get items.(get i)))))
    (set items remaining)
  })
  (__ui-options__ (dict
    "kind" "node" "component" (component : dict) "props" (copy (props : dict))
    "children" (list) "overlays" (list) "handlers" (dict) "state" (dict "configured" (dict))
    "bounds" (vec4) "clip" (vec4) "measured" (vec2)) items)))

(let ui-repaint (fn (ui) (set ui.dirty true)))
(let ui-reflow (fn (ui) (set ui.layout-dirty true) (ui-repaint ui)))
(let ui-invalidate (fn (ui)
  (set ui.measure-dirty true) (set ui.layout-target nil) (ui-reflow ui)))

(let ui-contains (fn (bounds x y)
  (and (>= x bounds.x) (>= y bounds.y)
    (< x (+ bounds.x bounds.z)) (< y (+ bounds.y bounds.w)))))

(let ui-intersect (fn (a b)
  (let x (max a.x b.x))
  (let y (max a.y b.y))
  (vec4 x y (max 0 (- (min (+ a.x a.z) (+ b.x b.z)) x))
    (max 0 (- (min (+ a.y a.w) (+ b.y b.w)) y)))))

(let __ui-rectangle-shader__ (sh (bounds:vec4 clip:vec4 color:vec4)
  (if (and (>= xy.x bounds.x) (>= xy.y bounds.y)
    (< xy.x (+ bounds.x bounds.z)) (< xy.y (+ bounds.y bounds.w))
    (>= xy.x clip.x) (>= xy.y clip.y)
    (< xy.x (+ clip.x clip.z)) (< xy.y (+ clip.y clip.w)))
    (return color))
  (vec4)))

(let __ui-image-shader__ (sh (image:texture2d bounds:vec4 clip:vec4)
  (let p (- xy bounds.xy))
  (if (and (>= p.x 0) (>= p.y 0) (< p.x image.w) (< p.y image.h)
    (>= xy.x clip.x) (>= xy.y clip.y)
    (< xy.x (+ clip.x clip.z)) (< xy.y (+ clip.y clip.w)))
    (return (sample image (/ p image.wh))))
  (vec4)))

(let __ui-border-shader__ (sh (bounds:vec4 clip:vec4 color:vec4 thickness:f32)
  (if (and (>= xy.x bounds.x) (>= xy.y bounds.y)
    (< xy.x (+ bounds.x bounds.z)) (< xy.y (+ bounds.y bounds.w))
    (>= xy.x clip.x) (>= xy.y clip.y)
    (< xy.x (+ clip.x clip.z)) (< xy.y (+ clip.y clip.w))
    (or (< xy.x (+ bounds.x thickness)) (< xy.y (+ bounds.y thickness))
      (>= xy.x (- (+ bounds.x bounds.z) thickness))
      (>= xy.y (- (+ bounds.y bounds.w) thickness))))
    (return color))
  (vec4)))

(let __ui-rectangle__ (fn (context bounds clip color)
  (layer context (ui-intersect bounds clip) __ui-rectangle-shader__ bounds clip color)))
(let __ui-image__ (fn (context image bounds clip)
  (layer context (ui-intersect bounds clip) __ui-image-shader__ image bounds clip)))

(let __ui-icon-shader__ (sh (image:texture2d bounds:vec4 clip:vec4 color:vec4)
  (if (and (>= xy.x bounds.x) (>= xy.y bounds.y)
    (< xy.x (+ bounds.x bounds.z)) (< xy.y (+ bounds.y bounds.w))
    (>= xy.x clip.x) (>= xy.y clip.y)
    (< xy.x (+ clip.x clip.z)) (< xy.y (+ clip.y clip.w))) {
    (let pixel (sample image (/ (- xy bounds.xy) bounds.zw)))
    (return (vec4 color.xyz (* color.w pixel.w)))
  })
  (vec4)))
(let ui-icon-image (fn (context image bounds clip color scale)
  (let physical (* bounds scale))
  (let clipped (* clip scale))
  (layer context (ui-intersect physical clipped) __ui-icon-shader__ image physical clipped color)))
(let __ui-border__ (fn (context bounds clip color thickness edges)
  ; Shade the four border strips, not every pixel inside a pane.
  (set edges (or edges (vec4 thickness)))
  (let middle (max 0 (- bounds.w edges.y edges.w)))
  (layer-regions context (list
    (ui-intersect clip (vec4 bounds.x bounds.y bounds.z edges.y))
    (ui-intersect clip (vec4 bounds.x (- (+ bounds.y bounds.w) edges.w) bounds.z edges.w))
    (ui-intersect clip (vec4 bounds.x (+ bounds.y edges.y) edges.x middle))
    (ui-intersect clip (vec4 (- (+ bounds.x bounds.z) edges.z) (+ bounds.y edges.y) edges.z middle)))
    __ui-border-shader__ bounds clip color thickness)))

(let ui-rectangle (fn (context node color)
  (let scale (or node.state.scale 1))
  (__ui-rectangle__ context (* node.bounds scale) (* node.clip scale) color)))

; Snap texture origins to device pixels so linear sampling does not blur text.
(let ui-pixel-position (fn (position)
  (vec2 (i32 (+ position.x (if (< position.x 0) -0.5 0.5)))
    (i32 (+ position.y (if (< position.y 0) -0.5 0.5))))))

(let ui-image (fn (context image position clip scale)
  (set scale (or scale 1))
  (__ui-image__ context image (vec4 (ui-pixel-position (* position scale)) image.w image.h)
    (* clip scale))))

; Cache text by its actual properties. No DOM element implements a widget.
(let __ui-label-measure__ (fn (ui node)
  (let props node.props)
  (let typography node.props)
  (let key (list props.value typography.font typography.size (re-copy typography.color) ui.scale))
  (if (not (= node.state.text-key key)) {
    (set node.state.image (text (font typography.font) (size (* typography.size ui.scale))
      (fill typography.color) (wrap false) (span props.value)))
    (set node.state.text-key key)
    (ui-invalidate ui)
  })
  (let image node.state.image)
  (let pad (Layout.padding props.padding))
  (set node.state.text-extent (/ image.w ui.scale))
  (+ (vec2 (min (or props.title-width (/ image.w ui.scale)) (/ image.w ui.scale))
    (/ image.h ui.scale)) (* 2 pad))))

(let __ui-label-paint__ (fn (ui node context)
  (let image node.state.image)
  (let bounds (Layout.inset node.bounds node.props.padding))
  (if node.props.value {
    (let clipped (ui-intersect node.clip bounds))
    (let x (+ bounds.x (Layout.offset bounds.z (/ image.w ui.scale) (or node.props.h-align "left"))))
    ; Center visible glyphs, excluding the font's unused ascent/descent space.
    (let ink-height (/ (- image.ink.bottom image.ink.top) ui.scale))
    (let y (+ bounds.y (if (= (or node.props.v-align "top") "top") 0
      (- (Layout.offset bounds.w ink-height node.props.v-align) (/ image.ink.top ui.scale)))))
    (ui-image context image.texture
      (vec2 (- x (or node.state.marquee 0)) y) clipped ui.scale)
  })))

(let __ui-marquee-tick__ (fn (ui node context)
  (if (not node.props.marquee) (return))
  (let owner (or node.state.hover-owner node))
  (let hovered (and (not ui.drag) ui.hot (not ui.hot.props.chrome-button) (ui-path owner ui.hot)))
  (let pad (Layout.padding node.props.padding))
  (let visible-bounds (ui-intersect node.bounds node.clip))
  (let overflow (max 0 (- (or node.state.text-extent 0)
    (max 0 (- visible-bounds.z (* 2 pad.x))))))
  (let previous (or node.state.marquee 0))
  (if (or (not hovered) (= overflow 0)) {
    (set node.state.marquee 0)
    (set node.state.marquee-time 0)
    (set node.state.marquee-direction 1)
  } else {
    (set node.state.marquee-time (+ (or node.state.marquee-time 0) context.dt))
    (if (> node.state.marquee-time (or node.props.marquee-delay 0.6)) {
      (let direction (or node.state.marquee-direction 1))
      (set node.state.marquee (clamp (+ previous
        (* context.dt direction (or node.props.marquee-speed 30))) 0 overflow))
      (if (or (>= node.state.marquee overflow) (<= node.state.marquee 0)) {
        (set node.state.marquee-direction (- direction))
        (set node.state.marquee-time 0)
      })
    })
  })
  (if (not (= previous node.state.marquee)) (ui-repaint ui))))

(let ui-label-component (dict
  "measure" __ui-label-measure__ "paint" __ui-label-paint__ "tick" __ui-marquee-tick__))

(let ui-label (fn (value &rest options)
  (ui-node ui-label-component
    (dict "value" (value : str) "font" "sans-serif" "size" 16 "color" (vec4 0.87 0.9 0.95 1)
      "padding" 0 "v-align" "center") options)))

; Icons are leaves, like labels. A URL loads on mount; a texture is immediately usable.
(let __ui-icon-load__ (fn (ui node)
  (if (same? node.state.source node.props.source) (return))
  (let source node.props.source)
  (set node.state.source source)
  (set node.state.error nil)
  (set node.state.image (if (str? source) nil (source : texture2d)))
  (ui-invalidate ui)
  (if (str? source)
    (promise (image (Resources.resolve source node.props.source-origin))
      then (texture) {
        (if (and node.state.mounted (same? source node.props.source)) {
          (set node.state.image texture)
          (ui-invalidate ui)
        })
      }
      catch (error) {
        (if (and node.state.mounted (same? source node.props.source)) {
          (set node.state.error error)
          (ui-invalidate ui)
          (ui-event ui node "error" (dict "error" error))
        })
      }))))
(let __ui-icon-unmount__ (fn (ui node) (set node.state.source nil)))
(let __ui-icon-measure__ (fn (ui node)
  (if node.state.mounted (__ui-icon-load__ ui node))
  (let extent node.props.size)
  (let image node.state.image)
  (+ (if image (vec2 (* extent (/ image.w image.h)) extent) (vec2 extent))
    (* 2 (Layout.padding node.props.padding)))))
(let __ui-icon-paint__ (fn (ui node context)
  (if (and node.state.image node.props.color) {
    (let bounds (Layout.inset node.bounds node.props.padding))
    (let natural (vec2 (* node.props.size (/ node.state.image.w node.state.image.h)) node.props.size))
    (let factor (min (/ bounds.z natural.x) (/ bounds.w natural.y)))
    (if (and (= node.props.w nil) (= node.props.h nil)) (set factor (min 1 factor)))
    (let placed (Layout.align bounds (* natural factor) (or node.props.h-align "center") (or node.props.v-align "center")))
    (ui-icon-image context node.state.image placed node.clip node.props.color ui.scale)
  })))
(let ui-icon-component (dict "mount" __ui-icon-load__ "unmount" __ui-icon-unmount__
  "measure" __ui-icon-measure__ "paint" __ui-icon-paint__))
(let ui-icon (Resources.withOrigin (fn (origin source &rest options)
  (let reference (if (str? source) (Resources.resolve source origin) source))
  (let node (ui-node ui-icon-component (dict "source" reference "source-origin" origin
    "size" 16 "color" (vec4 0.87 0.9 0.95 1) "padding" 0) options))
  (if (not (str? source)) (set node.state.image (source : texture2d)))
  node) (source-url ".")))

(let __ui-button-paint__ (fn (ui node context)
  (let background node.props.background)
  (if node.state.hot (set background node.props.hover))
  (if (not (= node.state.pressed-id nil)) (set background node.props.pressed))
  (if node.props.disabled (set background node.props.disabled-background))
  (ui-rectangle context node background)))
(let __ui-button-overlay__ (fn (ui node context)
  (if (and (not node.props.disabled)
    (or node.state.focused (not (= node.state.pressed-id nil))))
    (__ui-outline__ context node.bounds node.clip node.props.focus-color ui.scale node.props.border-width))))

(let ui-button-component (dict
  "measure" (fn (ui node)
    (if node.state.value-label {
      (if (not (= node.props.value node.state.value))
        (set node.state.value-label.props.value node.props.value)
        else (set node.props.value node.state.value-label.props.value))
      (set node.state.value node.props.value)
    })
    (__ui-container-measure__ ui node))
  "arrange" (fn (ui node) (__ui-container-arrange__ ui node))
  "paint" __ui-button-paint__ "overlay" __ui-button-overlay__))

(let __ui-hover-owner__ (fn (node owner)
  (if (and (same? node.component ui-label-component) (= node.state.hover-owner nil))
    (set node.state.hover-owner owner))
  (for child node.children (__ui-hover-owner__ child owner))))

(let ui-button (fn (&rest items)
  (let node (ui-node ui-button-component
    (dict "axis" "x" "gap" 4 "h-align" "center" "v-align" "center"
      "padding" (vec2 10 4) "focusable" true "hit-children" false
      "cursor" "pointer"
      "background" (vec4 0.16 0.19 0.25 1) "hover" (vec4 0.23 0.28 0.36 1)
      "pressed" (vec4 0.12 0.16 0.23 1) "disabled-background" (vec4 0.1 0.11 0.14 1)
      "focus-color" (vec4 0.42 0.7 1 1) "border-width" 2) items))
  ; Preserve the mutable value shorthand for a button built from a single label.
  (if (and (= (len node.children) 1) (same? (get node.children.0).component ui-label-component)) {
    (set node.state.value-label (get node.children.0))
    (set node.props.value node.state.value-label.props.value)
    (set node.state.value node.props.value)
  })
  (for child node.children (__ui-hover-owner__ child node))
  node))

; Single-line input is ordinary Lisp; the host only supplies invisible native editing.
(let __ui-textbox-mount__ (fn (ui node)
  (set node.state.proxy (text-proxy (fn (edit) {
    (let value "")
    (for line edit.lines (set value $"{value}{line.text}"))
    (if (not (= value edit.content)) {
      (TextProxy.sync node.state.proxy value (min edit.anchor (len value)) (min edit.head (len value)))
      (set edit (TextProxy.snapshot node.state.proxy))
    })
    (set node.props.value value)
    (set node.state.edit edit)
    (ui-event ui node "change" (dict "value" value))
  })))
  (TextProxy.sync node.state.proxy node.props.value (len node.props.value) (len node.props.value))
  (set node.state.edit (TextProxy.snapshot node.state.proxy))
  (set node.state.key-release (TextProxy.listenKeys node.state.proxy
    (fn (event) (ui-input ui "keydown" event))))))
(let __ui-textbox-unmount__ (fn (ui node)
  (if node.state.key-release (node.state.key-release))
  (if node.state.proxy (TextProxy.dispose node.state.proxy))
  (set node.state.proxy nil)))
(let __ui-textbox-measure__ (fn (ui node)
  (if node.state.proxy (TextProxy.readOnly node.state.proxy (bool node.props.disabled)))
  (if (and node.state.proxy (not (= node.state.edit.content node.props.value))) {
    (TextProxy.sync node.state.proxy node.props.value (len node.props.value) (len node.props.value))
    (set node.state.edit (TextProxy.snapshot node.state.proxy))
  })
  (let typography node.props)
  (let key (list typography.font typography.size ui.scale))
  (if (not (= key node.state.cell-key)) {
    (let wide (text (font typography.font) (size (* typography.size ui.scale)) (for i 100 "M")))
    (let narrow (text (font typography.font) (size (* typography.size ui.scale)) "M"))
    (set node.state.cell (/ (- wide.w narrow.w) (* 99 ui.scale)))
    (set node.state.cell-key key)
  })
  (let appearance (list node.props.value typography.font typography.size (re-copy typography.color) ui.scale))
  (if (not (= appearance node.state.input-key)) {
    (set node.state.input-key appearance) (ui-repaint ui)
  })
  (vec2 100 32)))
(let __ui-textbox-event__ (fn (ui node name event)
  (if (= name "focus") (TextProxy.focus node.state.proxy))
  (if (= name "blur") (TextProxy.blur node.state.proxy))
  (if node.props.disabled (return))
  (if (and (= name "keydown") (= event.key "Enter")) {
    (set event.prevent-default true) (set event.stop true)
    (ui-event ui node "submit" (dict "value" node.props.value))
  })
  (if (or (= name "pointerdown")
    (and (= name "pointermove") node.state.selecting (> event.buttons 0))) {
    (if (= name "pointerdown") (set node.state.selecting true))
    (let pad (Layout.padding node.props.padding))
    (let column (i32 (max 0 (+ 0.5 (/ (+ (- event.x node.bounds.x pad.x)
      (or node.state.scroll 0)) node.state.cell)))))
    (TextProxy.select node.state.proxy 0 column (or event.shift (= name "pointermove")))
    (TextProxy.focus node.state.proxy) (set event.stop true)
  })
  (if (or (= name "pointerup") (= name "pointercancel")) (set node.state.selecting false))))
(let __ui-textbox-paint__ (fn (ui node context)
  (ui-rectangle context node node.props.background)
  (let typography node.props)
  (let clip (ui-intersect node.clip (Layout.inset node.bounds node.props.padding)))
  (let edit node.state.edit)
  (let head (* edit.head node.state.cell))
  (let scroll (or node.state.scroll 0))
  (if node.state.focused {
    (if (< head scroll) (set scroll head))
    (if (> (+ head node.state.cell) (+ scroll clip.z)) (set scroll (max 0 (- (+ head node.state.cell) clip.z))))
  })
  (set node.state.scroll scroll)
  (let raster-scroll (i32 (+ (* scroll ui.scale) 0.5)))
  (let raster-width (max 1 (i32 (+ (* clip.z ui.scale) 0.5))))
  (let key (list node.props.value typography.font typography.size (re-copy typography.color)
    ui.scale raster-width raster-scroll))
  (if (not (= key node.state.text-key)) {
    (set node.state.image (text (font typography.font) (size (* typography.size ui.scale))
      (width raster-width) (wrap false) (fill typography.color)
      (offset (vec2 (- raster-scroll) 0)) (span node.props.value)))
    (set node.state.text-key key)
  })
  (let origin (vec2 clip.x
    (+ clip.y (- (/ clip.w 2) (/ (+ node.state.image.ink.top node.state.image.ink.bottom) (* 2 ui.scale))))))
  (if (not (= edit.anchor edit.head)) {
    (let start (+ (- origin.x (/ raster-scroll ui.scale)) (* (min edit.anchor edit.head) node.state.cell)))
    (let width (* (abs (- edit.head edit.anchor)) node.state.cell))
    (__ui-rectangle__ context (* (vec4 start clip.y width clip.w) ui.scale) (* clip ui.scale) node.props.selection-color)
  })
  (ui-image context node.state.image.texture origin clip ui.scale)
  (if node.state.focused {
    (let position (ui-pixel-position (* (vec2 (+ (- origin.x (/ raster-scroll ui.scale)) head) clip.y) ui.scale)))
    (__ui-rectangle__ context (vec4 position ui.scale (* clip.w ui.scale)) (* clip ui.scale) typography.color)
    (TextProxy.caret node.state.proxy position (* clip.w ui.scale))
    (__ui-outline__ context node.bounds node.clip node.props.focus-color ui.scale node.props.border-width)
  })))
(let ui-textbox-component (dict "mount" __ui-textbox-mount__ "unmount" __ui-textbox-unmount__
  "measure" __ui-textbox-measure__ "event" __ui-textbox-event__ "paint" __ui-textbox-paint__))
(let ui-textbox (fn (value &rest options)
  (ui-node ui-textbox-component (dict "value" (value : str) "font" "monospace" "size" 14
    "padding" 6 "grow" 1 "h" 32 "focusable" true "cursor" "text"
    "color" (vec4 0.9 0.93 1 1) "background" (vec4 0.08 0.1 0.14 1)
    "focus-color" (vec4 0.42 0.7 1 1) "border-width" 2 "selection-color" (vec4 0.4 0.7 1 0.3)) options)))

(let __ui-container-measure__ (fn (ui node)
  (let width 0)
  (let height 0)
  (let count 0)
  (for child node.children {
    (ui-measure ui child)
    (if (= child.props.visible false) (continue))
    (set count (+ count 1))
    (if (= node.props.axis "x") {
      (set width (+ width child.measured.x))
      (set height (max height child.measured.y))
    } elif (= node.props.axis "y") {
      (set width (max width child.measured.x))
      (set height (+ height child.measured.y))
    } else {
      (set width (max width child.measured.x))
      (set height (max height child.measured.y))
    })
  })
  (let gap (* (max 0 (- count 1)) node.props.gap))
  (if (= node.props.axis "x") (set width (+ width gap)))
  (if (= node.props.axis "y") (set height (+ height gap)))
  (+ (vec2 width height) (* 2 (Layout.padding node.props.padding)))))

(let __ui-container-arrange__ (fn (ui node)
  (let bounds (Layout.inset node.bounds node.props.padding))
  (let axis node.props.axis)
  (if (= axis nil) {
    (for child node.children (ui-arrange ui child
      (Layout.align bounds child.measured (or node.props.h-align "stretch") (or node.props.v-align "stretch")) node.clip))
    (return)
  })
  (let used 0)
  (let grow 0)
  (let count 0)
  (for child node.children {
    (if (= child.props.visible false) (continue))
    (set count (+ count 1))
    (if (<= (or child.props.grow 0) 0)
      (set used (+ used (if (= axis "x") child.measured.x child.measured.y))))
    (set grow (+ grow (max 0 (or child.props.grow 0))))
  })
  (set used (+ used (* (max 0 (- count 1)) node.props.gap)))
  (let spare (max 0 (- (if (= axis "x") bounds.z bounds.w) used)))
  (let alignment (if (= axis "x") (or node.props.h-align "left") (or node.props.v-align "top")))
  (let position (+ (if (= axis "x") bounds.x bounds.y)
    (if (> grow 0) 0 (Layout.offset (if (= axis "x") bounds.z bounds.w) used alignment))))
  (for child node.children {
    (if (= child.props.visible false) (continue))
    (let extra (if (> grow 0) (* spare (/ (max 0 (or child.props.grow 0)) grow)) 0))
    (let extent (if (> (or child.props.grow 0) 0) extra
      (if (= axis "x") child.measured.x child.measured.y)))
    (let slot (if (= axis "x") (vec4 position bounds.y extent bounds.w)
      (vec4 bounds.x position bounds.z extent)))
    (ui-arrange ui child (Layout.align slot child.measured
      (if (= axis "x") "stretch" (or node.props.h-align "stretch"))
      (if (= axis "y") "stretch" (or node.props.v-align "stretch"))) node.clip)
    (set position (+ position extent node.props.gap))
  })))

(let __ui-container-paint__ (fn (ui node context)
  (if node.props.background (ui-rectangle context node node.props.background))))

(let ui-container-component (dict "measure" __ui-container-measure__
  "arrange" __ui-container-arrange__ "paint" __ui-container-paint__))

(let ui-box (fn (&rest items)
  (ui-node ui-container-component (dict "padding" 0 "gap" 0 "axis" nil) items)))
(let ui-vbox (fn (&rest items)
  (ui-node ui-container-component (dict "padding" 0 "gap" 8 "axis" "y") items)))
(let ui-hbox (fn (&rest items)
  (ui-node ui-container-component (dict "padding" 0 "gap" 8 "axis" "x") items)))

(let ui-measure (fn (ui node)
  (set node.state.scale ui.scale)
  (let props node.props)
  (let appearance (list ui.scale props.visible props.w props.h props.grow props.padding props.gap
    props.disabled props.title props.h-align props.v-align props.scroll-indicator-width props.scroll-indicator-size
    (re-copy props.scroll-indicator-color) props.scroll-x props.scroll-y props.scrollbar-size
    props.scrollbar-min-thumb props.wheel-line (re-copy props.scroll-state)
    (re-copy props.scrollbar-track) (re-copy props.scrollbar-color) (re-copy props.scrollbar-active-color)
    (re-copy props.background) (re-copy props.hover)
    (re-copy props.pressed) (re-copy props.focus-color) props.border-width
    (re-copy props.border-color) (re-copy props.border-hover-color) (re-copy props.border-active-color)))
  (if (not (= appearance node.state.appearance)) {
    (set node.state.appearance appearance)
    (ui-invalidate ui)
  })
  (if (= node.props.visible false) {
    (if (and ui.focus (ui-path node ui.focus)) (ui-focus ui (list)))
    (set node.measured (vec2)) (return)
  })
  (let measured (if node.component.measure (node.component.measure ui node) (vec2)))
  (for overlay node.overlays (ui-measure ui overlay))
  (set node.measured (vec2
    (max 0 (if (= node.props.w nil) measured.x node.props.w))
    (max 0 (if (= node.props.h nil) measured.y node.props.h))))))

(let ui-arrange (fn (ui node bounds clip)
  (if (= node.props.visible false) (return))
  (let clipped (ui-intersect bounds clip))
  (let changed (or (not (= bounds node.bounds)) (not (= clipped node.clip))))
  (if (and (not changed) (not ui.measure-dirty)) (return))
  (if changed (ui-repaint ui))
  (set node.bounds bounds)
  (set node.clip clipped)
  (if node.component.arrange (node.component.arrange ui node))))

(let ui-paint (fn (ui node context)
  (if (or (= node.props.visible false) (<= node.clip.z 0) (<= node.clip.w 0)) (return))
  (if node.component.paint (node.component.paint ui node context))
  (for child node.children (ui-paint ui child context))
  (if node.component.overlay (node.component.overlay ui node context))))

; Hit paths are lists, avoiding parent links or a generic handle registry.
(let ui-hit (fn (node x y)
  (if (or (= node.props.visible false) (= node.props.hit false)
    (not (ui-contains node.bounds x y)) (not (ui-contains node.clip x y))) (return nil))
  (let path (list node))
  (if (= node.props.hit-children false) (return path))
  (for offset (len node.children) {
    (let child (get node.children.(- (len node.children) offset 1)))
    (let found (ui-hit child x y))
    (if found {
      (for member found (insert path member))
      (return path)
    })
  })
  path))

(let ui-path (fn (node target)
  (if (same? node target) (return (list node)))
  (for child node.children {
    (let found (ui-path child target))
    (if found {
      (let path (list node))
      (for member found (insert path member))
      (return path)
    })
  })
  nil))

(let ui-event (fn (ui node name source)
  (__ui-emit__ ui (ui-path ui.root node) name source)
  (ui-invalidate ui)))

(let __ui-emit__ (fn (ui path name source)
  (if (not path) (return nil))
  (let event (copy source))
  (set event.ui ui)
  (set event.name name)
  (set event.target (get path.(- (len path) 1)))
  (set event.stop false)
  (set event.prevent-default false)
  (for offset (len path) {
    (let node (get path.(- (len path) offset 1)))
    (set event.current-target node)
    (if node.component.event (node.component.event ui node name event))
    (let handlers (get node.handlers.(get name)))
    (if handlers (for handler (copy handlers) {
      (handler event)
      (set event.handled true)
      (ui-invalidate ui)
      (if event.stop (break))
    }))
    (if event.stop (break))
  })
  event))

(let ui-focus (fn (ui path)
  (if ui.focus {
    (set ui.focus.state.focused false)
    (__ui-emit__ ui ui.focus-path "blur" (dict))
  })
  (set ui.focus nil)
  (set ui.focus-path nil)
  (for offset (len path) {
    (let index (- (len path) offset 1))
    (let node (get path.(get index)))
    (if (and node.props.focusable (not node.props.disabled)) {
      (set ui.focus node)
      (set node.state.focused true)
      (set ui.focus-path (list))
      (for i (+ index 1) (insert ui.focus-path (get path.(get i))))
      (__ui-emit__ ui ui.focus-path "focus" (dict))
      (break)
    })
  })
  ; Reveal inner viewports before their ancestors so nested focus stays visible.
  (let focused-path (or ui.focus-path (list)))
  (for offset (len focused-path) {
    (let ancestor (get focused-path.(- (len focused-path) offset 1)))
    (if (and (same? ancestor.component ui-scroll-component) (not (same? ancestor ui.focus))) {
      (let viewport ancestor.state.viewport)
      (let position (copy ancestor.state.offset))
      ; Wide rows cannot fit horizontally; preserve the user's horizontal offset.
      (if (<= ui.focus.bounds.z viewport.z) {
        (if (< ui.focus.bounds.x viewport.x)
          (set position.x (+ position.x (- ui.focus.bounds.x viewport.x)))
          elif (> (+ ui.focus.bounds.x ui.focus.bounds.z) (+ viewport.x viewport.z))
          (set position.x (+ position.x (- (+ ui.focus.bounds.x ui.focus.bounds.z) (+ viewport.x viewport.z)))))
      })
      (if (< ui.focus.bounds.y viewport.y)
        (set position.y (+ position.y (- ui.focus.bounds.y viewport.y)))
        elif (> (+ ui.focus.bounds.y ui.focus.bounds.w) (+ viewport.y viewport.w))
        (set position.y (+ position.y (- (+ ui.focus.bounds.y ui.focus.bounds.w) (+ viewport.y viewport.w)))))
      (ui-scroll-to ui ancestor position)
    })
    (if (or (same? ancestor.component ui-strip-component) (same? ancestor.component ui-taskbar-component)) {
      (let viewport (or ancestor.state.viewport (Layout.inset ancestor.bounds ancestor.props.padding)))
      (let left viewport.x)
      (let right (+ viewport.x viewport.z))
      (let scroll (or ancestor.state.scroll 0))
      (if (< ui.focus.bounds.x left) (set scroll (+ scroll (- ui.focus.bounds.x left))))
      (if (> (+ ui.focus.bounds.x ui.focus.bounds.z) right)
        (set scroll (+ scroll (- (+ ui.focus.bounds.x ui.focus.bounds.z) right))))
      (set ancestor.state.scroll (clamp scroll 0 (or ancestor.state.max-scroll 0)))
    })
  })
  (ui-invalidate ui)))

(let __ui-focus-paths__ (fn (node path result)
  (if (= node.props.visible false) (return))
  (let current (copy path))
  (insert current node)
  (if (and node.props.focusable (not node.props.disabled)) (insert result current))
  (if (not (= node.props.hit-children false))
    (for child node.children (__ui-focus-paths__ child current result)))))

(let ui-input (fn (ui name source)
  (if (not ui.mounted) (return))
  (let original source)
  (set source (copy source))
  (if (and ui.drag (= name "keydown") (= source.code "Escape")) {
    (let id ui.drag.id)
    (ui-dock-drag ui "pointercancel" (dict "id" id))
    (__ui-release-pointer__ ui id)
    (set original.handled true)
    (set original.prevent-default true)
    (ui-update-cursor ui)
    (ui-invalidate ui)
    (return)
  })
  (if (not (= source.x nil)) {
    (set source.x (/ source.x ui.scale))
    (set source.y (/ source.y ui.scale))
    (if source.xy (set source.xy (/ source.xy ui.scale)))
    (set ui.pointer (vec2 source.x source.y))
  })
  (if (= name "pointerleave") (set ui.pointer nil))
  (if (and ui.drag (not (= source.id nil)) (= ui.drag.id source.id)) {
    (set original.handled true)
    (ui-dock-drag ui name source)
    (ui-update-cursor ui)
    (ui-reflow ui)
    (return)
  })
  (if (and (= name "pointerdown") (= source.button 0)
    (not (and ui.popup (ui-hit ui.popup.node source.x source.y)))
    (ui-dock-grip ui source)) {
      (set original.handled true)
      (if ui.popup (ui-close-popup ui))
      (ui-update-cursor ui)
      (return)
    })
  (let path nil)
  (if (or (= name "keydown") (= name "keyup")) {
    (set path ui.focus-path)
  } else {
    (if (not (= source.x nil)) {
      (set path (if ui.popup (ui-hit ui.popup.node source.x source.y) nil))
      (if (not path) {
        (if (and ui.popup (= name "pointerdown")) (ui-close-popup ui))
        (set path (ui-hit ui.root source.x source.y))
      })
    } elif ui.pointer {
      (set path (ui-hit ui.root ui.pointer.x ui.pointer.y))
    })
  })
  (let target (if path (get path.(- (len path) 1)) nil))
  (if (= name "pointermove") {
    (if (not (same? ui.hot target)) {
      (if ui.hot (set ui.hot.state.hot false))
      (set ui.hot target)
      (if target (set target.state.hot true))
      (ui-repaint ui)
    })
  })
  (if (= name "pointerleave") {
    (if ui.hot (set ui.hot.state.hot false))
    (set ui.hot nil)
  })
  (if (and (= name "pointerdown") (= source.button 0)) {
    (ui-focus ui (or path (list)))
    (if (and target target.props.focusable (not target.props.disabled)) {
      (set target.state.pressed-id source.id)
      (insert ui.pressed (dict "id" source.id "path" path))
    })
  })
  ; Captured pointer movement reaches the pressed component outside its bounds.
  (let captured nil)
  (for press ui.pressed {
    (if (= press.id source.id) { (set captured press.path) (break) })
  })
  (let delivery (or captured path))
  (let event (__ui-emit__ ui delivery name source))
  (if (or (= name "pointerup") (= name "pointercancel")) {
    (if captured {
      (let pressed (get captured.(- (len captured) 1)))
      (let click (and (= name "pointerup") (= source.button 0) target
        (= target.state.pressed-id source.id) (not pressed.props.disabled)))
      (set pressed.state.pressed-id nil)
      (for i (len ui.pressed) {
        (if (= (get ui.pressed.(get i)).id source.id) { (remove ui.pressed i) (break) })
      })
      (let clicked-popup (and ui.popup (same? (get captured.0) ui.popup.node)))
      (if (and click (not event.prevent-default)) (__ui-emit__ ui captured "click" source))
      (if (and clicked-popup click ui.popup ui.popup.close-on-click) (ui-close-popup ui))
    })
  })
  (if (and (= name "keydown") (= source.code "Tab") (not (and event event.prevent-default))) {
    (set source.prevent-default true)
    (let paths (list))
    (__ui-focus-paths__ (if ui.popup ui.popup.node ui.root) (list) paths)
    (if paths {
      (let current -1)
      (for i (len paths) {
        (let candidate (get paths.(get i)))
        (if (get candidate.(- (len candidate) 1)).state.focused (set current i))
      })
      (let next (+ current (if source.shift -1 1)))
      (if (< next 0) (set next (- (len paths) 1)))
      (if (>= next (len paths)) (set next 0))
      (ui-focus ui (get paths.(get next)))
    })
  })
  (if (and (= name "keydown") (not source.repeat) ui.focus
    (same? ui.focus.component ui-button-component)
    (or (= source.code "Enter") (= source.code "Space")) (not event.prevent-default))
    {
      (set source.prevent-default true)
      (let clicked-popup (and ui.popup (same? (get ui.focus-path.0) ui.popup.node)))
      (__ui-emit__ ui ui.focus-path "click" source)
      (if (and clicked-popup ui.popup ui.popup.close-on-click) (ui-close-popup ui))
    })
  (if (= source.code "Escape") (ui-close-popup ui))
  (if (and event event.prevent-default) (set source.prevent-default true))
  (if source.prevent-default (set original.prevent-default true))
  (if (or captured (and target target.props.focusable)
    (and event (or event.handled event.stop event.prevent-default)))
    (set original.handled true))
  (ui-update-cursor ui)
  (if (not (= name "pointermove")) (ui-invalidate ui))))

(let __ui-lifecycle__ (fn (ui node operation)
  (let callback (get node.component.(get operation)))
  (if (= operation "mount") {
    (if (or node.state.mounted node.state.closed) (return))
    (set node.state.mounted true)
    (if callback (callback ui node))
  })
  (for child node.children (__ui-lifecycle__ ui child operation))
  (for overlay node.overlays (__ui-lifecycle__ ui overlay operation))
  (if (and (= operation "unmount") node.state.mounted) {
    (if callback (callback ui node))
    (set node.state.mounted false)
    (set node.state.focused false)
    (set node.state.hot false)
    (set node.state.pressed-id nil)
  })))

; Scrollable strips support menus, toolbars, and the minimized-pane tray.
(let __ui-strip-measure__ (fn (ui node)
  (for overlay node.overlays {
    (if (not overlay.state.configured.size) (set overlay.props.size node.props.scroll-indicator-size))
    (if (not overlay.state.configured.color) (set overlay.props.color node.props.scroll-indicator-color))
  })
  (let measured (__ui-container-measure__ ui node))
  (vec2 0 measured.y)))
(let __ui-strip-arrange__ (fn (ui node)
  (let inner (Layout.inset node.bounds node.props.padding))
  (let width 0)
  (for child node.children (set width (+ width child.measured.x)))
  (set width (+ width (* (max 0 (- (len node.children) 1)) node.props.gap)))
  (let available inner.z)
  ; Reserve both indicator gutters while overflowing, so scrolling cannot shift layout.
  (let gutter (if (> width available) (max 0 (min (/ available 2) node.props.scroll-indicator-width)) 0))
  (set node.state.indicator-gutter gutter)
  (set node.state.viewport (vec4 (+ inner.x gutter) inner.y (max 0 (- available (* 2 gutter))) inner.w))
  (set node.state.max-scroll (max 0 (- width node.state.viewport.z)))
  (set node.state.scroll (clamp (or node.state.scroll 0) 0 node.state.max-scroll))
  (let x (- node.state.viewport.x node.state.scroll))
  (let clip (ui-intersect node.clip node.state.viewport))
  (for child node.children {
    (ui-arrange ui child (vec4 x node.state.viewport.y
      child.measured.x node.state.viewport.w) clip)
    (set x (+ x child.measured.x node.props.gap))
  })
  (let size (min (min gutter inner.w) node.props.scroll-indicator-size))
  (for i (len node.overlays) {
    (let indicator (get node.overlays.(get i)))
    (set indicator.props.visible (and (> size 0)
      (if (= i 0) (> node.state.scroll 0) (< node.state.scroll node.state.max-scroll))))
    (let x (if (= i 0) (+ inner.x (/ (- gutter size) 2))
      (- (+ inner.x inner.z) (/ (+ gutter size) 2))))
    (ui-arrange ui indicator (vec4 x (+ inner.y (/ (- inner.w size) 2)) size size) node.clip)
  })))

(let __ui-scroll-chevron-shader__ (sh (bounds:vec4 color:vec4 direction:f32 thickness:f32)
  (let p (- xy (+ bounds.xy (/ bounds.zw 2))))
  (let y (abs p.y))
  (let edge (- p.x (* direction (- (* bounds.z 0.15) y))))
  (if (and (<= y (* bounds.w 0.3))
    (<= (abs edge) thickness))
    (return color))
  (vec4)))
(let __ui-chevron-component__ (dict
  "measure" (fn (ui node) (vec2 node.props.size))
  "paint" (fn (ui node context)
    (if node.props.color
      (layer context (* node.clip ui.scale) __ui-scroll-chevron-shader__
        (* node.bounds ui.scale) node.props.color node.props.direction ui.scale)))))
(let __ui-strip-indicators__ (fn (node)
  (set node.overlays (list
    (ui-node __ui-chevron-component__ (dict "size" 16 "direction" -1 "hit" false))
    (ui-node __ui-chevron-component__ (dict "size" 16 "direction" 1 "hit" false))))
  node))
(let __ui-strip-overlay__ (fn (ui node context)
  (for overlay node.overlays (ui-paint ui overlay context))))
(let __ui-strip-event__ (fn (ui node name event)
  (if (= name "wheel") {
    (let delta (if (= event.dx 0) event.dy event.dx))
    (if (= event.mode 1) (set delta (* delta 20)))
    (if (= event.mode 2) (set delta (* delta node.bounds.z)))
    (set node.state.scroll (clamp (+ (or node.state.scroll 0) delta) 0 node.state.max-scroll))
    (set event.prevent-default true)
    (set event.stop true)
    (ui-invalidate ui)
  })))
(let ui-strip-component (dict "measure" __ui-strip-measure__
  "arrange" __ui-strip-arrange__ "paint" __ui-container-paint__ "event" __ui-strip-event__
  "overlay" __ui-strip-overlay__))
(let ui-bar (fn (&rest items)
  (__ui-strip-indicators__ (ui-node ui-strip-component (dict "axis" "x" "padding" 6 "gap" 6 "h" 40
    "scroll-indicator-width" 20 "scroll-indicator-size" 16 "scroll-indicator-color" (vec4 0.85 0.9 1 1)
    "background" (vec4 0.1 0.12 0.16 1)) items))))
(let ui-menu (fn (&rest items) (ui-bar items)))

; A viewport composes ordinary content and non-interactive scrollbar rectangles.
; The viewport owns scrollbar input; its children retain normal hit/focus routing.
(let __ui-scroll-measure__ (fn (ui node)
  (let content node.state.content)
  (set content.props.axis node.props.axis)
  (set content.props.gap node.props.gap)
  (ui-measure ui content)
  (+ (* 2 (Layout.padding node.props.padding))
    (vec2 (if node.props.scroll-x 0 content.measured.x)
      (if node.props.scroll-y 0 content.measured.y)))))

(let __ui-scroll-arrange__ (fn (ui node)
  (let inner (Layout.inset node.bounds node.props.padding))
  (let measured node.state.content.measured)
  (let thickness (max 0 node.props.scrollbar-size))
  (let show-x false)
  (let show-y false)
  ; One scrollbar may reduce the other axis enough to require its scrollbar.
  (for pass 2 {
    (set show-x (and node.props.scroll-x (> measured.x (- inner.z (if show-y thickness 0)))))
    (set show-y (and node.props.scroll-y (> measured.y (- inner.w (if show-x thickness 0)))))
  })
  (let viewport (vec4 inner.xy
    (max 0 (- inner.z (if show-y thickness 0)))
    (max 0 (- inner.w (if show-x thickness 0)))))
  (let extent (vec2 (if node.props.scroll-x (max measured.x viewport.z) viewport.z)
    (if node.props.scroll-y (max measured.y viewport.w) viewport.w)))
  (set node.state.viewport viewport)
  (set node.state.max-offset (max (vec2) (- extent viewport.zw)))
  ; Retain the requested position while asynchronously populated content is empty.
  (if node.props.scroll-state
    (set node.state.offset (vec2 (or node.props.scroll-state.x 0) (or node.props.scroll-state.y 0))))
  (set node.state.offset (vec2
    (clamp node.state.offset.x 0 node.state.max-offset.x)
    (clamp node.state.offset.y 0 node.state.max-offset.y)))
  (ui-arrange ui node.state.content (vec4 (- viewport.xy node.state.offset) extent)
    (ui-intersect node.clip viewport))
  (let track-x (vec4 viewport.x (+ viewport.y viewport.w) viewport.z (if show-x (min thickness inner.w) 0)))
  (let track-y (vec4 (+ viewport.x viewport.z) viewport.y (if show-y (min thickness inner.z) 0) viewport.w))
  (let thumb-w (min track-x.z (max node.props.scrollbar-min-thumb
    (* track-x.z (/ viewport.z (if (> extent.x 0) extent.x 1))))))
  (let thumb-h (min track-y.w (max node.props.scrollbar-min-thumb
    (* track-y.w (/ viewport.w (if (> extent.y 0) extent.y 1))))))
  (let thumb-x (vec4 (+ track-x.x (* (- track-x.z thumb-w)
    (/ node.state.offset.x (if (> node.state.max-offset.x 0) node.state.max-offset.x 1)))) track-x.y thumb-w track-x.w))
  (let thumb-y (vec4 track-y.x (+ track-y.y (* (- track-y.w thumb-h)
    (/ node.state.offset.y (if (> node.state.max-offset.y 0) node.state.max-offset.y 1)))) track-y.z thumb-h))
  (set node.state.track-x track-x) (set node.state.track-y track-y)
  (set node.state.thumb-x thumb-x) (set node.state.thumb-y thumb-y)
  (let rectangles (list track-x thumb-x track-y thumb-y))
  (for i 4 {
    (let overlay (get node.overlays.(get i)))
    (let horizontal (< i 2))
    (set overlay.props.visible (if horizontal show-x show-y))
    (set overlay.props.background (if (= (% i 2) 0) node.props.scrollbar-track
      (if (and node.state.drag (= node.state.drag.axis (if horizontal "x" "y")))
        node.props.scrollbar-active-color node.props.scrollbar-color)))
    (ui-arrange ui overlay (get rectangles.(get i)) node.clip)
  })))

(let ui-scroll-to (fn (ui node position)
  (set position (position : vec2))
  (let next (vec2 (clamp position.x 0 node.state.max-offset.x)
    (clamp position.y 0 node.state.max-offset.y)))
  (if node.props.scroll-state {
    (set node.props.scroll-state.x next.x) (set node.props.scroll-state.y next.y)
  })
  (if (= next node.state.offset) (return false))
  (set node.state.offset next)
  (__ui-scroll-arrange__ ui node)
  (ui-repaint ui)
  true))

(let __ui-scroll-drag__ (fn (ui node event)
  (let horizontal (= node.state.drag.axis "x"))
  (let track (if horizontal node.state.track-x node.state.track-y))
  (let thumb (if horizontal node.state.thumb-x node.state.thumb-y))
  (let travel (if horizontal (- track.z thumb.z) (- track.w thumb.w)))
  (let point (- (if horizontal event.x event.y) (if horizontal track.x track.y) node.state.drag.grab))
  (let position (copy node.state.offset))
  (let value (* (clamp (/ point (if (> travel 0) travel 1)) 0 1)
    (if horizontal node.state.max-offset.x node.state.max-offset.y)))
  (if horizontal (set position.x value) else (set position.y value))
  (ui-scroll-to ui node position)))

(let __ui-scroll-event__ (fn (ui node name event)
  (if node.props.disabled (return))
  (if (and (= name "pointerdown") (= event.button 0)) {
    (let horizontal (ui-contains node.state.track-x event.x event.y))
    (let vertical (ui-contains node.state.track-y event.x event.y))
    (if (or horizontal vertical) {
      (let thumb (if horizontal node.state.thumb-x node.state.thumb-y))
      (let inside (ui-contains thumb event.x event.y))
      (set node.state.drag (dict "id" event.id "axis" (if horizontal "x" "y")
        "grab" (if inside (- (if horizontal event.x event.y) (if horizontal thumb.x thumb.y))
          (/ (if horizontal thumb.z thumb.w) 2))))
      (__ui-scroll-drag__ ui node event)
      (__ui-scroll-arrange__ ui node)
      (ui-repaint ui)
      (set event.stop true) (set event.prevent-default true)
      (return)
    })
  })
  (if (and node.state.drag (= event.id node.state.drag.id)) {
    (if (= name "pointermove") (__ui-scroll-drag__ ui node event))
    (if (or (= name "pointerup") (= name "pointercancel")) {
      (set node.state.drag nil)
      (__ui-scroll-arrange__ ui node) (ui-repaint ui)
    })
    (set event.stop true) (set event.prevent-default true)
    (return)
  })
  (if event.prevent-default (return))
  (if (= name "wheel") {
    (let dx (or event.dx 0)) (let dy (or event.dy 0))
    (if event.shift { (if (= dx 0) (set dx dy)) (set dy 0) })
    (if (= event.mode 1) { (set dx (* dx node.props.wheel-line)) (set dy (* dy node.props.wheel-line)) })
    (if (= event.mode 2) { (set dx (* dx node.state.viewport.z)) (set dy (* dy node.state.viewport.w)) })
    (if (ui-scroll-to ui node (+ node.state.offset (vec2 dx dy))) {
      (set event.prevent-default true) (set event.stop true)
    })
  })
  (if (and (= name "keydown") (same? event.target node)) {
    (let position (copy node.state.offset))
    (if (= event.code "ArrowDown") (set position.y (+ position.y node.props.wheel-line))
      elif (= event.code "ArrowUp") (set position.y (- position.y node.props.wheel-line))
      elif (= event.code "ArrowRight") (set position.x (+ position.x node.props.wheel-line))
      elif (= event.code "ArrowLeft") (set position.x (- position.x node.props.wheel-line))
      elif (= event.code "PageDown") (set position.y (+ position.y node.state.viewport.w))
      elif (= event.code "PageUp") (set position.y (- position.y node.state.viewport.w))
      elif (= event.code "Home") {
        (if (or event.ctrl (not node.props.scroll-y)) (set position.x 0))
        (set position.y 0)
      } elif (= event.code "End") {
        (if (or event.ctrl (not node.props.scroll-y)) (set position.x node.state.max-offset.x))
        (set position.y node.state.max-offset.y)
      } else (return))
    (ui-scroll-to ui node position)
    (set event.prevent-default true) (set event.stop true)
  })))

(let ui-scroll-component (dict "measure" __ui-scroll-measure__ "arrange" __ui-scroll-arrange__
  "event" __ui-scroll-event__ "paint" __ui-container-paint__ "overlay" __ui-strip-overlay__))
(let ui-scroll (fn (&rest items)
  (let node (ui-node ui-scroll-component (dict "axis" "y" "padding" 0 "gap" 8 "grow" 1
    "focusable" true "scroll-x" false "scroll-y" true "scrollbar-size" 8 "scrollbar-min-thumb" 20 "wheel-line" 20
    "scrollbar-track" (vec4 0.08 0.1 0.14 1) "scrollbar-color" (vec4 0.4 0.45 0.55 1)
    "scrollbar-active-color" (vec4 0.6 0.78 1 1)) items))
  (set node.state.content (ui-vbox node.children))
  (set node.children (list node.state.content))
  (set node.state.offset (vec2)) (set node.state.max-offset (vec2))
  (set node.state.viewport (vec4))
  (set node.overlays (list (ui-box) (ui-box) (ui-box) (ui-box)))
  (for overlay node.overlays (set overlay.props.hit false))
  node))

(let ui-close-popup (fn (ui)
  (if ui.popup {
    (if (and ui.focus-path (same? (get ui.focus-path.0) ui.popup.node)) (ui-focus ui (list)))
    (__ui-lifecycle__ ui ui.popup.node "unmount")
  })
  (set ui.popup nil)
  (ui-invalidate ui)))
(let ui-open-popup (fn (ui node anchor)
  (ui-close-popup ui)
  (set ui.popup (dict "node" node "anchor" anchor "close-on-click" true))
  (__ui-lifecycle__ ui node "mount")
  (let paths (list))
  (__ui-focus-paths__ node (list) paths)
  (if paths (ui-focus ui (get paths.0)))
  (ui-invalidate ui)))
(let ui-dropdown (fn (title &rest items)
  (let children (list))
  (let options (list))
  (let collect (fn (items)
    (for item items {
      (if (list? item) (collect item)
        elif (and (dict? item) (or (= item.kind "config") (= item.kind "style") (= item.kind "handler"))) (insert options item)
        else (insert children item))
    })))
  (collect items)
  (let popup (ui-vbox (padding 6)
    (gap 2)
    (background (vec4 0.13 0.16 0.21 1)) children))
  (let node (ui-button title options (ui-on "click" (fn (event)
    (ui-open-popup event.ui popup event.current-target)))))
  (set node.state.popup-node popup)
  node))

; Docking is an editable split tree, owned by a workspace instance.
(let __ui-dock-active__ (fn (tree)
  (if (= tree nil) (return false))
  (if (= tree.kind "node") (return (and (not tree.state.minimized)
    (not tree.state.closed) (not tree.state.floating) (not (= tree.props.visible false)))))
  (or (__ui-dock-active__ tree.first) (__ui-dock-active__ tree.second))))

(let __ui-dock-has__ (fn (tree pane)
  (if (= tree nil) (return false))
  (if (= tree.kind "node") (return (= tree.state.dock-id pane.state.dock-id)))
  (or (__ui-dock-has__ tree.first pane) (__ui-dock-has__ tree.second pane))))

(let __ui-dock-remove__ (fn (tree pane)
  (if (= tree nil) (return nil))
  (if (= tree.kind "node")
    (return (if (= tree.state.dock-id pane.state.dock-id) nil tree)))
  (let first (__ui-dock-remove__ tree.first pane))
  (let second (__ui-dock-remove__ tree.second pane))
  (if (= first nil) (return second))
  (if (= second nil) (return first))
  (let result (copy tree))
  (set result.first first)
  (set result.second second)
  result))

(let __ui-dock-insert__ (fn (tree target pane edge)
  (if (= tree nil) (return pane))
  ; A workspace may contain only hidden slots. Preserve them when docking into it.
  (if (= target nil) (return (dict "kind" "split" "axis" "x" "ratio" 0.5
    "first" tree "second" pane)))
  (if (= tree.kind "node") {
    (if (not (= tree.state.dock-id target.state.dock-id)) (return tree))
    (let before (or (= edge "left") (= edge "top")))
    (return (dict "kind" "split" "axis" (if (or (= edge "left") (= edge "right")) "x" "y")
      "ratio" 0.5 "first" (if before pane tree) "second" (if before tree pane)))
  })
  (let result (copy tree))
  (set result.first (__ui-dock-insert__ tree.first target pane edge))
  (set result.second (__ui-dock-insert__ tree.second target pane edge))
  result))

(let __ui-dock-minimum__ (fn (tree gap)
  (if (not (__ui-dock-active__ tree)) (return (vec2)))
  (if (= tree.kind "node") (return (vec2 tree.props.min-w tree.props.min-h)))
  (let a (__ui-dock-minimum__ tree.first gap))
  (let b (__ui-dock-minimum__ tree.second gap))
  (if (not (__ui-dock-active__ tree.first)) (return b))
  (if (not (__ui-dock-active__ tree.second)) (return a))
  (return (if (= tree.axis "x") (vec2 (+ a.x b.x gap) (max a.y b.y))
    (vec2 (max a.x b.x) (+ a.y b.y gap))))))

(let __ui-dock-tree-data__ (fn (tree)
  (if (= tree nil) (return nil))
  (if (= tree.kind "node") (return (dict "kind" "pane" "id" tree.props.id)))
  (dict "kind" "split" "axis" tree.axis "ratio" tree.ratio
    "first" (__ui-dock-tree-data__ tree.first) "second" (__ui-dock-tree-data__ tree.second))))

(let ui-dock-save (fn (workspace)
  (if (= workspace.props.layout nil) (return))
  (let layout workspace.props.layout)
  (set layout.tree (__ui-dock-tree-data__ workspace.state.tree))
  (set layout.order (list))
  (set layout.panes (list))
  (for pane workspace.state.panes {
    (insert layout.order pane.props.id)
    (let bounds pane.state.rect)
    (insert layout.panes (dict "id" pane.props.id "floating" pane.state.floating
      "minimized" pane.state.minimized "closed" pane.state.closed
      "rect" (list bounds.x bounds.y bounds.z bounds.w)))
  })))

(let __ui-dock-tree-restore__ (fn (workspace saved)
  (if (= saved nil) (return nil))
  (if (= saved.kind "pane") {
    (for pane workspace.state.panes {
      (if (and (= pane.props.id saved.id) (not pane.state.closed) (not pane.state.floating))
        (return pane))
    })
    (return nil)
  })
  (let first (__ui-dock-tree-restore__ workspace saved.first))
  (let second (__ui-dock-tree-restore__ workspace saved.second))
  (if (= first nil) (return second))
  (if (= second nil) (return first))
  (dict "kind" "split" "axis" saved.axis "ratio" saved.ratio "first" first "second" second)))

(let __ui-dock-layout__ (fn (ui workspace tree bounds)
  (if (not (__ui-dock-active__ tree)) (return))
  (if (= tree.kind "node") {
    (ui-arrange ui tree bounds workspace.clip)
    (return)
  })
  (set tree.bounds bounds)
  ; Hidden branches consume no space, but retain their original split ratios.
  (if (not (__ui-dock-active__ tree.first)) {
    (__ui-dock-layout__ ui workspace tree.second bounds)
    (return)
  })
  (if (not (__ui-dock-active__ tree.second)) {
    (__ui-dock-layout__ ui workspace tree.first bounds)
    (return)
  })
  (let gap workspace.props.divider)
  (let horizontal (= tree.axis "x"))
  (let extent (max 0 (- (if horizontal bounds.z bounds.w) gap)))
  (let a (__ui-dock-minimum__ tree.first gap))
  (let b (__ui-dock-minimum__ tree.second gap))
  (let minimum (if horizontal a.x a.y))
  (let maximum (- extent (if horizontal b.x b.y)))
  (let split (if (>= maximum minimum) (clamp (* extent tree.ratio) minimum maximum)
    (* extent (/ minimum (max 1 (+ minimum (if horizontal b.x b.y)))))))
  (let first (if horizontal (vec4 bounds.x bounds.y split bounds.w)
    (vec4 bounds.x bounds.y bounds.z split)))
  (let second (if horizontal (vec4 (+ bounds.x split gap) bounds.y (max 0 (- extent split)) bounds.w)
    (vec4 bounds.x (+ bounds.y split gap) bounds.z (max 0 (- extent split)))))
  (insert workspace.state.dividers (dict "tree" tree
    "bounds" (if horizontal (vec4 (+ bounds.x split) bounds.y gap bounds.w)
      (vec4 bounds.x (+ bounds.y split) bounds.z gap))))
  (__ui-dock-layout__ ui workspace tree.first first)
  (__ui-dock-layout__ ui workspace tree.second second)))

(let __ui-dock-mount__ (fn (ui workspace)
  (insert ui.workspaces workspace)
  (set workspace.state.panes (copy workspace.children))
  (set workspace.state.dividers (list))
  (set workspace.state.tree nil)
  (set workspace.state.version 0)
  (let count 0)
  (let docked 0)
  (for pane workspace.children {
    (set pane.state.workspace workspace)
    (set pane.state.dock-id count)
    (set pane.state.floating (bool pane.props.floating))
    (set pane.state.minimized false)
    (set pane.state.closed (bool pane.props.closed))
    (if pane.state.closed (set pane.props.visible false))
    (set pane.state.rect (vec4 20 20 pane.props.float-w pane.props.float-h))
    (if (not (or pane.state.floating pane.state.closed)) {
      (set workspace.state.tree (if (= docked 0) pane
        (dict "kind" "split" "axis" "x" "ratio" (/ docked (+ docked 1))
          "first" workspace.state.tree "second" pane)))
      (set docked (+ docked 1))
    })
    (set count (+ count 1))
  })
  (let layout workspace.props.layout)
  (if (and layout layout.panes) {
    (for pane workspace.state.panes {
      (let found false)
      (for saved layout.panes {
        (if (= pane.props.id saved.id) {
          (set found true)
          (set pane.state.floating saved.floating)
          (set pane.state.minimized saved.minimized)
          (set pane.state.closed saved.closed)
          (set pane.props.visible (not (or saved.closed saved.minimized)))
          (set pane.state.rect (vec4 saved.rect))
          (break)
        })
      })
      (if (not found) (set pane.state.floating true))
    })
    (set workspace.state.tree (__ui-dock-tree-restore__ workspace layout.tree))
    (if layout.order {
      (let ordered (list))
      (for id layout.order (for pane workspace.state.panes {
        (if (= pane.props.id id) { (insert ordered pane) (break) })
      }))
      (for pane workspace.state.panes
        (if (= (__ui-index__ ordered pane) nil) (insert ordered pane)))
      (set workspace.state.panes ordered)
    })
  })
  (ui-dock-save workspace)))

(let __ui-dock-arrange__ (fn (ui workspace)
  ; Restoring a docked slot must not cover floating panes or their resize grips.
  (let ordered (list))
  (for pane workspace.children (if (not pane.state.floating) (insert ordered pane)))
  (for pane workspace.children (if pane.state.floating (insert ordered pane)))
  (let order-changed (not (= (len ordered) (len workspace.children))))
  (for i (len ordered)
    (if (not (same? (get ordered.(get i)) (get workspace.children.(get i))))
      (set order-changed true)))
  (if order-changed {
    (set workspace.children ordered)
    (ui-invalidate ui)
  })
  (set workspace.state.dividers (list))
  (if ui.measure-dirty (for pane workspace.children (ui-measure ui pane)))
  (__ui-dock-layout__ ui workspace workspace.state.tree workspace.bounds)
  (for pane workspace.children {
    (if (and pane.state.floating (not pane.state.minimized) (not pane.state.closed)) {
      (let bounds pane.state.rect)
      (let area workspace.bounds)
      (let width (max pane.props.min-w bounds.z))
      (let height (max pane.props.min-h bounds.w))
      (set pane.state.rect (vec4
        (clamp bounds.x (- area.x (max 0 (- width 48))) (+ area.x (max 0 (- area.z 48))))
        (clamp bounds.y area.y (+ area.y (max 0 (- area.w 32)))) width height))
      (ui-arrange ui pane pane.state.rect workspace.clip)
    })
  })
  (if (and ui.drag (= ui.drag.mode "move") (same? ui.drag.workspace workspace)) {
    (let preview (__ui-dock-preview__ workspace ui.drag.pane ui.drag.point.x ui.drag.point.y))
    (if (and preview ui.drag.preview
      (or (not (= preview.target-id ui.drag.preview.target-id))
        (not (= preview.edge ui.drag.preview.edge)) (not (= preview.bounds ui.drag.preview.bounds))))
      (__ui-dock-reset__ ui.drag))
    (if (or (= preview nil) (= ui.drag.preview nil)) (__ui-dock-reset__ ui.drag))
    (set ui.drag.preview preview)
  })))

(let __ui-dock-filled__ (fn (tree)
  (if (not (__ui-dock-active__ tree)) (return false))
  (if (= tree.kind "node") (return (and
    (same? tree.component.paint __ui-container-paint__) tree.props.background
    (>= tree.props.background.w 1))))
  (and (or (not (__ui-dock-active__ tree.first)) (__ui-dock-filled__ tree.first))
    (or (not (__ui-dock-active__ tree.second)) (__ui-dock-filled__ tree.second)))))

(let __ui-dock-paint__ (fn (ui workspace context)
  ; Opaque docked panes and dividers already cover the workspace completely.
  (if (not (and (__ui-dock-filled__ workspace.state.tree)
    (>= workspace.props.divider-color.w 1) (>= workspace.props.divider-hover-color.w 1)))
    (ui-rectangle context workspace workspace.props.background))
  (for divider workspace.state.dividers {
    (let color workspace.props.divider-color)
    (if (and ui.resize-hover (= ui.resize-hover.mode "split")
      (same? ui.resize-hover.split divider.tree)) (set color workspace.props.divider-hover-color))
    (__ui-rectangle__ context (* divider.bounds ui.scale) (* workspace.clip ui.scale)
      color)
  })))

(let __ui-outline__ (fn (context bounds clip color scale thickness)
  (let stroke (max 0 (min (min (/ bounds.z 2) (/ bounds.w 2))
    (if (= thickness nil) 2 thickness))))
  (if (= stroke 0) (return))
  (__ui-border__ context (* bounds scale) (* clip scale) color (* stroke scale))))

(let __ui-dock-ready__ (fn (drag)
  (let delay drag.workspace.props.dwell-delay)
  (>= drag.elapsed (+ (max 0 (if (= delay nil) 0.15 delay))
    (max 0.001 drag.workspace.props.dwell)))))

(let __ui-dock-overlay__ (fn (ui workspace context)
  (if (or (= ui.drag nil) (= ui.drag.preview nil)) (return))
  (let preview ui.drag.preview)
  (if (not (same? ui.drag.workspace workspace)) (return))
  (let progress (clamp (or ui.drag.progress 0) 0 1))
  (let ready (__ui-dock-ready__ ui.drag))
  (__ui-rectangle__ context (* preview.bounds ui.scale) (* workspace.clip ui.scale)
    workspace.props.preview-background)
  (__ui-rectangle__ context
    (* (vec4 preview.bounds.x preview.bounds.y (* preview.bounds.z progress) preview.bounds.w) ui.scale)
    (* workspace.clip ui.scale) (if ready workspace.props.preview-ready workspace.props.preview-fill))
  (__ui-outline__ context preview.bounds workspace.clip
    (if ready workspace.props.preview-ready-outline workspace.props.preview-outline) ui.scale)))

(let ui-dock-component (dict "mount" __ui-dock-mount__
  "measure" (fn (ui workspace) (vec2)) "arrange" __ui-dock-arrange__
  "paint" __ui-dock-paint__ "overlay" __ui-dock-overlay__))

(let ui-dock (fn (&rest panes)
  (ui-node ui-dock-component (dict "grow" 1 "divider" 0 "dwell" 0.6 "dwell-delay" 0.15
    "dwell-decay" 0.2 "hold-radius" 6
    "drag-threshold" 6 "undock-shrink" 32 "undock-shrink-bottom" 64
    "background" (vec4 0.06 0.07 0.09 1) "divider-color" (vec4 0.38 0.44 0.54 1)
    "divider-hover-color" (vec4 0.6 0.78 1 1)
    "preview-background" (vec4 0.3 0.5 0.8 0.12) "preview-outline" (vec4 0.45 0.7 1 1)
    "preview-fill" (vec4 0.3 0.55 0.9 0.35) "preview-ready" (vec4 0.2 0.75 0.45 0.4)
    "preview-ready-outline" (vec4 0.35 1 0.6 1)) panes)))

(let __ui-pane-blur__ (fn (ui pane)
  (for member (or ui.focus-path (list)) {
    (if (same? member pane) { (ui-focus ui (list)) (break) })
  })))

(let ui-pane-minimize (fn (ui pane)
  (let workspace pane.state.workspace)
  (if (or (= workspace nil) pane.state.closed pane.state.minimized) (return))
  (__ui-pane-blur__ ui pane)
  ; Keep docked panes in the tree as hidden slots; floating panes keep their rectangle.
  (set pane.state.rect (copy (if pane.state.floating pane.state.rect pane.bounds)))
  (set pane.state.minimized true)
  (set pane.props.visible false)
  (set workspace.state.version (+ workspace.state.version 1))
  (ui-dock-save workspace)
  (ui-invalidate ui)))

(let ui-pane-open (fn (ui pane)
  (let workspace pane.state.workspace)
  (if (= workspace nil) (return))
  (let closed pane.state.closed)
  (set pane.state.closed false)
  (set pane.state.minimized false)
  (set pane.props.visible true)
  (if closed (set pane.state.floating true))
  (let index (where workspace.children pane))
  (if (not (= index nil)) (remove workspace.children index))
  (insert workspace.children pane)
  (if closed (__ui-lifecycle__ ui pane "mount"))
  (if (and (not pane.state.floating) (not (__ui-dock-has__ workspace.state.tree pane)))
    (set workspace.state.tree (__ui-dock-insert__ workspace.state.tree nil pane "right")))
  (set workspace.state.version (+ workspace.state.version 1))
  (ui-dock-save workspace)
  (ui-invalidate ui)))

(let ui-pane-restore (fn (ui pane)
  (if pane.state.closed (return (ui-pane-open ui pane)))
  (let workspace pane.state.workspace)
  (if (or (= workspace nil) pane.state.closed (not pane.state.minimized)) (return))
  (set pane.state.minimized false)
  (set pane.props.visible true)
  ; Older saved layouts may lack a minimized pane's slot. Keep it docked in that case.
  (if (and (not pane.state.floating) (not (__ui-dock-has__ workspace.state.tree pane)))
    (set workspace.state.tree (__ui-dock-insert__ workspace.state.tree nil pane "right")))
  (let index (where workspace.children pane))
  (if (not (= index nil)) (remove workspace.children index))
  (insert workspace.children pane)
  (set workspace.state.version (+ workspace.state.version 1))
  (ui-dock-save workspace)
  (ui-invalidate ui)))

(let ui-pane-close (fn (ui pane)
  (let workspace pane.state.workspace)
  (if (= workspace nil) (return))
  (__ui-pane-blur__ ui pane)
  (set workspace.state.tree (__ui-dock-remove__ workspace.state.tree pane))
  (set pane.state.closed true)
  (set pane.props.visible false)
  (__ui-lifecycle__ ui pane "unmount")
  (let index (where workspace.children pane))
  (if (not (= index nil)) (remove workspace.children index))
  (set workspace.state.version (+ workspace.state.version 1))
  (ui-dock-save workspace)
  (ui-invalidate ui)))

(let __ui-pane-arrange__ (fn (ui pane)
  (__ui-container-arrange__ ui pane)))
(let __ui-pane-measure__ (fn (ui pane)
  (if pane.state.title-node {
    (if (not (= pane.props.title pane.state.title-value))
      (set pane.state.title-node.props.value pane.props.title)
      else (set pane.props.title pane.state.title-node.props.value))
    (set pane.state.title-value pane.props.title)
  })
  (__ui-container-measure__ ui pane)))
(let __ui-pane-overlay__ (fn (ui pane context)
  (let color pane.props.border-color)
  (if (and ui.resize-hover (= ui.resize-hover.mode "resize") (same? ui.resize-hover.pane pane))
    (set color pane.props.border-hover-color))
  (if (and ui.drag (same? ui.drag.pane pane)
    (or (= ui.drag.mode "resize") (= ui.drag.mode "move")))
    (set color pane.props.border-active-color))
  (let width pane.props.border-width)
  (let edges (vec4 width))
  (if (and (not pane.state.floating) (= pane.state.workspace.props.divider 0)) {
    (let area pane.state.workspace.bounds)
    (if (> pane.bounds.x area.x) (set edges.x (/ width 2)))
    (if (> pane.bounds.y area.y) (set edges.y (/ width 2)))
    (if (< (+ pane.bounds.x pane.bounds.z) (+ area.x area.z)) (set edges.z (/ width 2)))
    (if (< (+ pane.bounds.y pane.bounds.w) (+ area.y area.w)) (set edges.w (/ width 2)))
  })
  (__ui-border__ context (* pane.bounds ui.scale) (* pane.clip ui.scale)
    color (* width ui.scale) (* edges ui.scale))))
(let ui-pane-component (dict "measure" __ui-pane-measure__
  "arrange" __ui-pane-arrange__ "paint" __ui-container-paint__ "overlay" __ui-pane-overlay__))

(let __ui-find-component__ (fn (node component)
  (if (same? node.component component) (return node))
  (for child node.children {
    (let found (__ui-find-component__ child component))
    (if found (return found))
  })
  nil))

(let ui-pane (fn (title &rest items)
  (let title-custom (not (str? title)))
  (let title-content (if title-custom title (ui-label title (ui-prop "marquee" true) (ui-prop "title-width" 160))))
  (let title-node (__ui-find-component__ title-content ui-label-component))
  (if (not (in "grow" title-content.props)) (set title-content.props.grow 1))
  (if title-node {
    (if (not (in "marquee" title-node.props)) (set title-node.props.marquee true))
    (if (not (in "title-width" title-node.props)) (set title-node.props.title-width 160))
  })
  (let title-value (if title-custom (or (if title-node title-node.props.value nil) "Pane") title))
  (let pane (ui-node ui-pane-component
    (dict "title" title-value "id" title-value "axis" "y" "gap" 0 "padding" 2
      "min-w" 220 "min-h" 100 "float-w" 420 "float-h" 320
      "border-width" 2 "border-color" (vec4 0.43 0.5 0.62 1)
      "border-hover-color" (vec4 0.65 0.82 1 1) "border-active-color" (vec4 0.45 0.72 1 1)
      "background" (vec4 0.09 0.11 0.15 1))))
  (__ui-options__ pane items)
  (let body (ui-vbox (grow 1) (padding 10) pane.children))
  (set pane.children (list))
  (let header (ui-hbox (height 32)
    (padding 3)
    (gap 3)
    (ui-prop "cursor" "grab")
    (background (vec4 0.14 0.17 0.22 1))
    (ui-hbox (grow 1) (gap 4) (v-align "center") (padding 5)
      (ui-label "::") title-content)
    (ui-button "_" (ui-prop "chrome-button" true)
      (padding 5)
      (width 26)
      (ui-on "click" (fn (event) (ui-pane-minimize event.ui pane))))
    (ui-button "x" (ui-prop "chrome-button" true)
      (padding 5)
      (width 26)
      (ui-on "click" (fn (event) (ui-pane-close event.ui pane))))
    (ui-on "pointerdown" (fn (event)
      (if (and (= event.button 0) (not event.target.props.chrome-button)) {
        (ui-dock-start event.ui pane event)
        (set event.stop true)
      })))))
  (insert pane.children header)
  (insert pane.children body)
  (set pane.state.title-content (get header.children.0))
  (set pane.state.title-node title-node)
  (set pane.state.title-custom title-custom)
  (set pane.state.title-value title-value)
  (set pane.state.title-icon (__ui-find-component__ title-content ui-icon-component))
  (if title-node (set title-node.state.hover-owner header))
  pane))

; Readiness restarts immediately; the visible fill drains in ui-update.
(let __ui-dock-reset__ (fn (drag)
  (set drag.elapsed 0)
  (set drag.reset true)))

(let ui-dock-start (fn (ui pane event)
  (let workspace pane.state.workspace)
  (if (= workspace nil) (return))
  ; A handle press captures a possible drag without changing the pane's layout.
  (set ui.drag (dict "mode" "pending" "id" event.id "pane" pane "workspace" workspace
    "tree" workspace.state.tree "floating" pane.state.floating "start" (copy pane.bounds)
    "offset" (vec2 (- event.x pane.bounds.x) (- event.y pane.bounds.y))
    "anchor" (vec2 event.x event.y) "point" (vec2 event.x event.y)
    "elapsed" 0 "progress" 0 "reset" false "preview" nil))
  (ui-invalidate ui)))

(let __ui-dock-begin-drag__ (fn (ui drag)
  (let pane drag.pane)
  (let workspace drag.workspace)
  (let bounds (copy pane.bounds))
  (set drag.tree workspace.state.tree)
  (set drag.floating pane.state.floating)
  (set drag.start bounds)
  (if (not pane.state.floating) {
    (let shrink (max 0 (if (= workspace.props.undock-shrink nil) 32 workspace.props.undock-shrink)))
    (let width (max 1 pane.props.min-w (- bounds.z (* 2 shrink))))
    (let height (max 1 pane.props.min-h (- bounds.w
      (if (= workspace.props.undock-shrink-bottom nil) (* shrink 2) workspace.props.undock-shrink-bottom))))
    ; Center the width reduction around the grab, retaining the title's vertical offset.
    (set drag.offset (vec2
      (clamp (- drag.offset.x (/ (- bounds.z width) 2)) 0 (- width 1))
      (clamp drag.offset.y 0 (min 31 (- height 1)))))
    (set bounds (vec4 bounds.x bounds.y width height))
  })
  (set drag.mode "move")
  (set workspace.state.tree (__ui-dock-remove__ workspace.state.tree pane))
  (set pane.state.floating true)
  (set pane.state.rect bounds)
  (let index (where workspace.children pane))
  (if (not (= index nil)) (remove workspace.children index))
  (insert workspace.children pane)
  (ui-invalidate ui)))

(let __ui-dock-target__ (fn (workspace tree x y)
  (if (not (__ui-dock-active__ tree)) (return nil))
  (if (= tree.kind "split")
    (return (or (__ui-dock-target__ workspace tree.first x y)
      (__ui-dock-target__ workspace tree.second x y))))
  (let bounds tree.bounds)
  (if (not (ui-contains bounds x y)) (return nil))
  (let distances (list (/ (- x bounds.x) (max 1 bounds.z))
    (/ (- (+ bounds.x bounds.z) x) (max 1 bounds.z))
    (/ (- y bounds.y) (max 1 bounds.w))
    (/ (- (+ bounds.y bounds.w) y) (max 1 bounds.w))))
  (let nearest 0)
  (for i 4 (if (< (get distances.(get i)) (get distances.(get nearest))) (set nearest i)))
  (if (> (get distances.(get nearest)) 0.25) (return nil))
  (let edge (get (list "left" "right" "top" "bottom").(get nearest)))
  (let preview (if (< nearest 2)
    (vec4 (+ bounds.x (if (= nearest 1) (/ bounds.z 2) 0)) bounds.y (/ bounds.z 2) bounds.w)
    (vec4 bounds.x (+ bounds.y (if (= nearest 3) (/ bounds.w 2) 0)) bounds.z (/ bounds.w 2))))
  (dict "target" tree "target-id" tree.state.dock-id "edge" edge "bounds" preview)))

(let __ui-dock-preview__ (fn (workspace pane x y)
  (if (not (__ui-dock-active__ workspace.state.tree)) {
    (if (and (ui-contains workspace.bounds x y) (>= workspace.bounds.z pane.props.min-w)
      (>= workspace.bounds.w pane.props.min-h))
      (return (dict "target" nil "target-id" -1 "edge" "empty" "bounds" workspace.bounds)))
    (return nil)
  })
  (let preview (__ui-dock-target__ workspace workspace.state.tree x y))
  (if (= preview nil) (return nil))
  (let bounds preview.target.bounds)
  (let horizontal (or (= preview.edge "left") (= preview.edge "right")))
  (let before (or (= preview.edge "left") (= preview.edge "top")))
  (let extent (- (if horizontal bounds.z bounds.w) workspace.props.divider))
  (let pane-min (if horizontal pane.props.min-w pane.props.min-h))
  (let target-min (if horizontal preview.target.props.min-w preview.target.props.min-h))
  (if (< extent (+ pane-min target-min)) (return nil))
  (let first (clamp (/ extent 2) (if before pane-min target-min)
    (- extent (if before target-min pane-min))))
  (let offset (if before 0 (+ first workspace.props.divider)))
  (let size (if before first (- extent first)))
  (set preview.bounds (if horizontal (vec4 (+ bounds.x offset) bounds.y size bounds.w)
    (vec4 bounds.x (+ bounds.y offset) bounds.z size)))
  preview))

; Hover and pointer-down share exactly the same resize regions.
(let __ui-resize-cursor__ (fn (left right top-edge bottom)
  (if (and (or left right) (or top-edge bottom))
    (return (if (or (and left top-edge) (and right bottom)) "nwse-resize" "nesw-resize")))
  (if (or left right) (return "ew-resize"))
  "ns-resize"))

(let ui-dock-hit (fn (ui x y)
  (for workspace ui.workspaces {
    (let path (ui-path ui.root workspace))
    (let visible (bool path))
    (for ancestor (or path (list)) {
      (if (or (= ancestor.props.visible false) (= ancestor.props.hit false)) (set visible false))
    })
    (if (not visible) (continue))
    (if (or (not (ui-contains workspace.bounds x y))
      (not (ui-contains workspace.clip x y))) (continue))
    (for offset (len workspace.children) {
      (let pane (get workspace.children.(- (len workspace.children) offset 1)))
      (if (or (not pane.state.floating) pane.state.minimized pane.state.closed
        (= pane.props.visible false)) (continue))
      (let bounds pane.bounds)
      (if (not (ui-contains (vec4 (- bounds.x 7) (- bounds.y 7) (+ bounds.z 14) (+ bounds.w 14))
        x y)) (continue))
      (let left (<= x (+ bounds.x 7)))
      (let right (>= x (- (+ bounds.x bounds.z) 7)))
      (let top-edge (<= y (+ bounds.y 7)))
      (let bottom (>= y (- (+ bounds.y bounds.w) 7)))
      (if (or left right top-edge bottom) {
        (return (dict "mode" "resize" "pane" pane "workspace" workspace
          "left" left "right" right "top" top-edge "bottom" bottom
          "cursor" (__ui-resize-cursor__ left right top-edge bottom)))
      })
      ; Floating contents cover the dock dividers underneath.
      (return nil)
    })
    (for divider workspace.state.dividers {
      (let bounds divider.bounds)
      (let grip (if (= divider.tree.axis "x")
        (vec4 (- bounds.x 4) bounds.y (+ bounds.z 8) bounds.w)
        (vec4 bounds.x (- bounds.y 4) bounds.z (+ bounds.w 8))))
      (if (ui-contains grip x y) {
        (return (dict "mode" "split" "workspace" workspace "split" divider.tree
          "divider-bounds" divider.bounds
          "cursor" (if (= divider.tree.axis "x") "col-resize" "row-resize")))
      })
    })
  })
  nil))

; Resize a shared edge while holding every other parallel divider in place.
(let __ui-resize-snapshot__ (fn (tree)
  (if (= tree nil) (return))
  (set tree.__resize_bounds__ (copy tree.bounds))
  (if (= tree.kind "split") {
    (set tree.__resize_ratio__ tree.ratio)
    (__ui-resize-snapshot__ tree.first)
    (__ui-resize-snapshot__ tree.second)
  })))
(let __ui-resize-finish__ (fn (tree cancel)
  (if (= tree nil) (return))
  (set tree.__resize_bounds__ nil)
  (if (= tree.kind "split") {
    (if cancel (set tree.ratio tree.__resize_ratio__))
    (set tree.__resize_ratio__ nil)
    (__ui-resize-finish__ tree.first cancel)
    (__ui-resize-finish__ tree.second cancel)
  })))
(let __ui-edge-minimum__ (fn (tree axis side gap)
  (if (not (__ui-dock-active__ tree)) (return 0))
  (if (= tree.kind "node") (return (if (= axis "x") tree.props.min-w tree.props.min-h)))
  (if (not (__ui-dock-active__ tree.first))
    (return (__ui-edge-minimum__ tree.second axis side gap)))
  (if (not (__ui-dock-active__ tree.second))
    (return (__ui-edge-minimum__ tree.first axis side gap)))
  (if (= tree.axis axis) {
    (let fixed (if (= side "end") tree.first.__resize_bounds__ tree.second.__resize_bounds__))
    (return (+ gap (if (= axis "x") fixed.z fixed.w)
      (__ui-edge-minimum__ (if (= side "end") tree.second tree.first) axis side gap)))
  })
  (max (__ui-edge-minimum__ tree.first axis side gap)
    (__ui-edge-minimum__ tree.second axis side gap))))
(let __ui-edge-stretch__ (fn (tree bounds axis side gap)
  (if (or (not (__ui-dock-active__ tree)) (= tree.kind "node")) (return))
  (if (not (__ui-dock-active__ tree.first)) {
    (__ui-edge-stretch__ tree.second bounds axis side gap) (return)
  })
  (if (not (__ui-dock-active__ tree.second)) {
    (__ui-edge-stretch__ tree.first bounds axis side gap) (return)
  })
  (let horizontal (= tree.axis "x"))
  (let extent (max 1 (- (if horizontal bounds.z bounds.w) gap)))
  (let first tree.first.__resize_bounds__)
  (let split (if horizontal first.z first.w))
  (if (and (= tree.axis axis) (= side "start")) {
    (let original tree.__resize_bounds__)
    (set split (+ split (- (if horizontal bounds.z bounds.w)
      (if horizontal original.z original.w))))
  })
  (set tree.ratio (clamp (/ split extent) 0 1))
  (__ui-edge-stretch__ tree.first
    (if horizontal (vec4 bounds.x bounds.y split bounds.w)
      (vec4 bounds.x bounds.y bounds.z split)) axis side gap)
  (__ui-edge-stretch__ tree.second
    (if horizontal (vec4 (+ bounds.x split gap) bounds.y (- extent split) bounds.w)
      (vec4 bounds.x (+ bounds.y split gap) bounds.z (- extent split))) axis side gap)))

(let ui-dock-grip (fn (ui event)
  (let hit (ui-dock-hit ui event.x event.y))
  (if (= hit nil) (return false))
  (set hit.id event.id)
  (if (= hit.mode "resize") {
    (set hit.start (copy hit.pane.bounds))
    (set hit.anchor (vec2 event.x event.y))
  } else {
    (set hit.ratio hit.split.ratio)
    (set hit.anchor (vec2 event.x event.y))
    (set hit.position (if (= hit.split.axis "x")
      (- hit.divider-bounds.x hit.split.bounds.x)
      (- hit.divider-bounds.y hit.split.bounds.y)))
    (__ui-resize-snapshot__ hit.split)
  })
  (set ui.drag hit)
  true))

(let __ui-path-cursor__ (fn (path)
  (for offset (len path) {
    (let node (get path.(- (len path) offset 1)))
    (if node.props.disabled (return "not-allowed"))
    (if node.props.cursor (return (node.props.cursor : str)))
  })
  "auto"))

(let ui-update-cursor (fn (ui)
  (let hit nil)
  (let value nil)
  (if ui.mounted {
    (if ui.drag {
      (if (or (= ui.drag.mode "resize") (= ui.drag.mode "split")) {
        (set hit ui.drag)
        (set value ui.drag.cursor)
      } else (set value (if (or (= ui.drag.mode "move") (= ui.drag.mode "taskbar")) "grabbing" "grab")))
    } elif ui.pressed {
      (set value (__ui-path-cursor__ (get ui.pressed.(- (len ui.pressed) 1)).path))
    } elif ui.pointer {
      (let path (if ui.popup (ui-hit ui.popup.node ui.pointer.x ui.pointer.y) nil))
      (if (not path) {
        (set hit (ui-dock-hit ui ui.pointer.x ui.pointer.y))
        (if hit (set value hit.cursor)
          (set path (ui-hit ui.root ui.pointer.x ui.pointer.y)))
      })
      (if path (set value (__ui-path-cursor__ path)))
    })
  })
  (let previous ui.resize-hover)
  (let changed (not (= (= hit nil) (= previous nil))))
  (if (and hit previous) (set changed (or (not (= hit.mode previous.mode))
    (not (same? hit.pane previous.pane)) (not (same? hit.split previous.split))
    (not (= hit.cursor previous.cursor)))))
  (set ui.resize-hover hit)
  (set ui.cursor value)
  (if changed (ui-repaint ui))
  (cursor value)))

(let ui-dock-drag (fn (ui name event)
  (let drag ui.drag)
  (if (or (= drag.mode "taskbar-pending") (= drag.mode "taskbar")) {
    (__ui-taskbar-drag__ ui name event) (return)
  })
  (let workspace drag.workspace)
  (if (= drag.mode "pending") {
    (if (or (= name "pointerup") (= name "pointercancel")) {
      (set ui.drag nil)
      (ui-invalidate ui)
      (return)
    })
    (if (not (= name "pointermove")) (return))
    (let dx (- event.x drag.anchor.x))
    (let dy (- event.y drag.anchor.y))
    (let threshold (max 0 (if (= workspace.props.drag-threshold nil) 6 workspace.props.drag-threshold)))
    (if (<= (+ (* dx dx) (* dy dy)) (* threshold threshold)) (return))
    (__ui-dock-begin-drag__ ui drag)
  })
  (if (= name "pointercancel") {
    (if (= drag.mode "split") (__ui-resize-finish__ drag.split true))
    (if (= drag.mode "resize") (set drag.pane.state.rect drag.start))
    (if drag.restore-minimized {
      (set drag.pane.state.minimized true)
      (set drag.pane.props.visible false)
      (set workspace.state.panes drag.original-order)
      (set workspace.state.version (+ workspace.state.version 1))
    })
    (if (= drag.mode "move") {
      (set workspace.state.tree drag.tree)
      (set drag.pane.state.floating drag.floating)
      (set drag.pane.state.rect drag.start)
    })
    (set ui.drag nil)
    (return)
  })
  (if (= name "pointermove") {
    (if (= drag.mode "split") {
      (let bounds drag.split.__resize_bounds__)
      (let horizontal (= drag.split.axis "x"))
      (let gap workspace.props.divider)
      (let extent (max 1 (- (if horizontal bounds.z bounds.w) gap)))
      (let position (+ drag.position (if horizontal
        (- event.x drag.anchor.x) (- event.y drag.anchor.y))))
      (let low (/ (__ui-edge-minimum__ drag.split.first drag.split.axis "end" gap) extent))
      (let high (- 1 (/ (__ui-edge-minimum__ drag.split.second drag.split.axis "start" gap) extent)))
      (if (<= low high) {
        (set position (* extent (clamp (/ position extent) low high)))
        (set drag.split.ratio (/ position extent))
        (__ui-edge-stretch__ drag.split.first
          (if horizontal (vec4 bounds.x bounds.y position bounds.w)
            (vec4 bounds.x bounds.y bounds.z position)) drag.split.axis "end" gap)
        (__ui-edge-stretch__ drag.split.second
          (if horizontal (vec4 (+ bounds.x position gap) bounds.y (- extent position) bounds.w)
            (vec4 bounds.x (+ bounds.y position gap) bounds.z (- extent position)))
          drag.split.axis "start" gap)
      })
    } elif (= drag.mode "resize") {
      (let pane drag.pane)
      (let bounds drag.start)
      (let dx (- event.x drag.anchor.x))
      (let dy (- event.y drag.anchor.y))
      (let x (if drag.left (min (+ bounds.x dx) (- (+ bounds.x bounds.z) pane.props.min-w)) bounds.x))
      (let y (if drag.top (min (+ bounds.y dy) (- (+ bounds.y bounds.w) pane.props.min-h)) bounds.y))
      (let right (if drag.right (max (+ bounds.x bounds.z dx) (+ x pane.props.min-w)) (+ bounds.x bounds.z)))
      (let bottom (if drag.bottom (max (+ bounds.y bounds.w dy) (+ y pane.props.min-h)) (+ bounds.y bounds.w)))
      (set pane.state.rect (vec4 x y (- right x) (- bottom y)))
    } else {
      (let pane drag.pane)
      (let bounds pane.state.rect)
      (let area workspace.bounds)
      (let width (max pane.props.min-w bounds.z))
      (let height (max pane.props.min-h bounds.w))
      (set pane.state.rect (vec4
        (clamp (- event.x drag.offset.x) (- area.x (max 0 (- width 48)))
          (+ area.x (max 0 (- area.z 48))))
        (clamp (- event.y drag.offset.y) area.y (+ area.y (max 0 (- area.w 32)))) width height))
      (set drag.point (vec2 event.x event.y))
      (let preview (__ui-dock-preview__ workspace pane event.x event.y))
      (let changed (or (= preview nil) (= drag.preview nil)))
      (if (and preview drag.preview) (set changed
        (or (not (= preview.target-id drag.preview.target-id))
          (not (= preview.edge drag.preview.edge)) (not (= preview.bounds drag.preview.bounds)))))
      (if (or changed (> (max (- event.x drag.anchor.x) (- drag.anchor.x event.x)) workspace.props.hold-radius)
        (> (max (- event.y drag.anchor.y) (- drag.anchor.y event.y)) workspace.props.hold-radius)) {
        (__ui-dock-reset__ drag)
        (set drag.anchor (vec2 event.x event.y))
      })
      (set drag.preview preview)
    })
  })
  (if (= name "pointerup") {
    (if (= drag.mode "split") (__ui-resize-finish__ drag.split false))
    (if (and (= drag.mode "move") drag.preview (__ui-dock-ready__ drag)) {
      (set workspace.state.tree (__ui-dock-insert__ workspace.state.tree
        drag.preview.target drag.pane drag.preview.edge))
      (set drag.pane.state.floating false)
    })
    (set ui.drag nil)
    (ui-dock-save workspace)
  })
  (if (not ui.measure-dirty) (set ui.layout-target workspace))
  (ui-reflow ui)))

(let __ui-index__ (fn (items value)
  (for i (len items) (if (same? (get items.(get i)) value) (return i)))
  nil))
(let __ui-release-pointer__ (fn (ui id)
  (for offset (len ui.pressed) {
    (let i (- (len ui.pressed) offset 1))
    (let press (get ui.pressed.(get i)))
    (if (= press.id id) {
      (set (get press.path.(- (len press.path) 1)).state.pressed-id nil)
      (remove ui.pressed i)
    })
  })))
(let __ui-taskbar-event__ (fn (ui node name event)
  (__ui-strip-event__ ui node name event)
  (if (and (= name "pointerdown") (= event.button 0) event.target.props.pane) {
    (let pane event.target.props.pane)
    (set ui.drag (dict "mode" "taskbar-pending" "id" event.id "pane" pane
      "workspace" node.props.workspace "taskbar" node "button" event.target
      "anchor" (vec2 event.x event.y) "order" (copy node.props.workspace.state.panes)))
    (set event.stop true)
  })))
(let __ui-taskbar-drag__ (fn (ui name event)
  (let drag ui.drag)
  (let workspace drag.workspace)
  (let node drag.taskbar)
  (if (= name "pointercancel") {
    (set workspace.state.panes drag.order)
    (set workspace.state.version (+ workspace.state.version 1))
    (__ui-release-pointer__ ui drag.id)
    (set ui.drag nil)
    (ui-dock-save workspace)
    (ui-invalidate ui)
    (return)
  })
  (if (= name "pointerup") {
    (__ui-release-pointer__ ui drag.id)
    (set ui.drag nil)
    (if (= drag.mode "taskbar-pending") (ui-pane-restore ui drag.pane))
    (ui-dock-save workspace)
    (ui-invalidate ui)
    (return)
  })
  (if (not (= name "pointermove")) (return))
  (let dx (- event.x drag.anchor.x))
  (let dy (- event.y drag.anchor.y))
  (let threshold workspace.props.drag-threshold)
  (if (and (= drag.mode "taskbar-pending")
    (<= (+ (* dx dx) (* dy dy)) (* threshold threshold))) (return))
  (set drag.mode "taskbar")
  (if (or (< event.y (- node.clip.y 8)) (> event.y (+ node.clip.y node.clip.w 8))) {
    ; Moving out of the tray restores the pane directly into a floating title drag.
    (__ui-release-pointer__ ui drag.id)
    (set drag.restore-minimized true)
    (set drag.original-order drag.order)
    (set drag.pane.state.minimized false)
    (set drag.pane.props.visible true)
    (set drag.mode "pending")
    (set drag.offset (vec2 (/ drag.pane.bounds.z 2) 16))
    (set drag.point (vec2 event.x event.y))
    (__ui-dock-begin-drag__ ui drag)
    (set workspace.state.version (+ workspace.state.version 1))
    (ui-dock-drag ui "pointermove" event)
    (ui-invalidate ui)
    (return)
  })
  (let before nil)
  (let last nil)
  (for child node.children {
    (if (or (= child.props.pane nil) (same? child.props.pane drag.pane)) (continue))
    (set last child.props.pane)
    (if (< event.x (+ child.bounds.x (/ child.bounds.z 2))) {
      (set before child.props.pane) (break)
    })
  })
  (if (or before last) {
    (let ordered (copy workspace.state.panes))
    (remove ordered (__ui-index__ ordered drag.pane))
    (let index (if before (__ui-index__ ordered before) (+ (__ui-index__ ordered last) 1)))
    (insert ordered drag.pane index)
    (let changed false)
    (for i (len ordered) (if (not (same? (get ordered.(get i))
      (get workspace.state.panes.(get i)))) (set changed true)))
    (if changed {
      (set workspace.state.panes ordered)
      (set workspace.state.version (+ workspace.state.version 1))
      (ui-dock-save workspace)
      (ui-invalidate ui)
    })
  })))

(let __ui-taskbar-measure__ (fn (ui node)
  (let workspace node.props.workspace)
  (let signature (list workspace.state.version))
  (for pane workspace.state.panes (insert signature
    (list pane.props.title pane.state.minimized pane.state.closed
      (if pane.state.title-icon pane.state.title-icon.props.source nil))))
  (if (not (= node.state.signature signature)) {
    (if (and ui.focus (ui-path node ui.focus)) (ui-focus ui (list)))
    (for child node.children {
      (if (= (where node.state.items child) nil) (__ui-lifecycle__ ui child "unmount"))
    })
    (set node.children (copy node.state.items))
    (for pane workspace.state.panes {
      (if (and pane.state.minimized (not pane.state.closed)) {
        (let visual (or node.props.item-style (dict)))
        (insert node.children (ui-button
          (ui-hbox (gap 4) (v-align "center")
            (if pane.state.title-icon (ui-icon pane.state.title-icon.props.source
              (size pane.state.title-icon.props.size) (fill pane.state.title-icon.props.color)) nil)
            (ui-label pane.props.title
              (font (or visual.font "sans-serif")) (size (or visual.size 16))
              (fill (if (in "color" visual) visual.color (vec4 0.87 0.9 0.95 1)))
              (ui-prop "marquee" true) (ui-prop "title-width" (or node.props.title-width 160))))
          (ui-config visual)
          (ui-prop "pane" pane)
          (ui-prop "cursor" "grab")
          (h-align "left")
          (ui-on "click" (fn (event) (ui-pane-restore event.ui pane)))))
      })
    })
    (set node.state.version workspace.state.version)
    (set node.state.signature signature)
    (for child node.children (__ui-lifecycle__ ui child "mount"))
    (ui-invalidate ui)
  })
  (__ui-strip-measure__ ui node)))
(let ui-taskbar-component (dict "measure" __ui-taskbar-measure__
  "arrange" __ui-strip-arrange__ "paint" __ui-container-paint__ "event" __ui-taskbar-event__
  "overlay" __ui-strip-overlay__))
(let ui-taskbar (fn (workspace &rest items)
  (let node (ui-node ui-taskbar-component (dict "workspace" workspace "axis" "x"
    "scroll-indicator-width" 20 "scroll-indicator-size" 16 "scroll-indicator-color" (vec4 0.85 0.9 1 1)
    "padding" 6 "gap" 6 "h" 40 "background" (vec4 0.1 0.12 0.16 1)) items))
  (set node.state.items (copy node.children))
  (__ui-strip-indicators__ node)))

(let ui-new (fn (root)
  (dict "root" (root : dict) "dirty" true "mounted" false "w" 0 "h" 0
    "observe" true "layout-dirty" true "measure-dirty" true "layout-target" nil
    "scale" 1 "applied-scale" 1
    "cursor" nil "resize-hover" nil
    "focus" nil "focus-path" nil "hot" nil "pointer" nil "pressed" (list)
    "workspaces" (list) "drag" nil "popup" nil
    "background" (vec4 0.07 0.08 0.11 1))))

(let ui-mount (fn (ui)
  (if ui.mounted (return ui))
  (set ui.mounted true)
  (set ui.input-release (listen-input (fn (name event)
    (if (in name __ui-input-names__) (ui-input ui name event)))))
  (__ui-lifecycle__ ui ui.root "mount")
  (ui-invalidate ui)
  ui))

(let ui-unmount (fn (ui)
  (if (not ui.mounted) (return))
  (if ui.input-release (ui.input-release))
  (set ui.input-release nil)
  (__ui-lifecycle__ ui ui.root "unmount")
  (ui-close-popup ui)
  (set ui.mounted false)
  (set ui.focus nil)
  (set ui.focus-path nil)
  (set ui.hot nil)
  (set ui.drag nil)
  (set ui.workspaces (list))
  (set ui.pressed (list))
  (set ui.pointer nil)
  (ui-update-cursor ui)))

(let ui-update (fn (ui context)
  (if (not ui.mounted) (return))
  (if (and ui.drag (= ui.drag.mode "move")) {
    (let drag ui.drag)
    (let dt (max 0 context.dt))
    (let dwell (max 0.001 drag.workspace.props.dwell))
    (let delay drag.workspace.props.dwell-delay)
    (set delay (max 0 (if (= delay nil) 0.15 delay)))
    (if drag.preview {
      (if (not drag.reset) (set drag.elapsed (min (+ delay dwell) (+ drag.elapsed dt))))
    } else (set drag.elapsed 0))
    (set drag.reset false)
    (let target (clamp (/ (- drag.elapsed delay) dwell) 0 1))
    (let progress (or drag.progress 0))
    (let decay (max 0.001 (or drag.workspace.props.dwell-decay 0.2)))
    (set drag.progress (if (> progress target) (max target (- progress (/ dt decay))) target))
    (if (not (= progress drag.progress)) (ui-repaint ui))
  })
  ; Context is supplied explicitly to update handlers.
  (let visit (fn (node)
    (if node.component.tick (node.component.tick ui node context))
    (for child node.children (visit child))
    (for overlay node.overlays (visit overlay))))
  (visit ui.root)
  (if ui.popup (visit ui.popup.node))))

(let ui-render (fn (ui context)
  (if (not ui.mounted) (return))
  (set ui.scale (max 0.01 ui.scale))
  (let width (/ context.w ui.scale))
  (let height (/ context.h ui.scale))
  (if (or (not (= ui.w width)) (not (= ui.h height))
    (not (= ui.applied-scale ui.scale))) (ui-invalidate ui))
  (set ui.applied-scale ui.scale)
  (set ui.w width)
  (set ui.h height)
  ; Automatic observation remains available; explicit invalidation has an idle fast path.
  (if ui.observe (set ui.measure-dirty true))
  (if ui.measure-dirty {
    (ui-measure ui ui.root)
    (if ui.popup (ui-measure ui ui.popup.node))
    (set ui.layout-dirty true)
  })
  (if ui.layout-dirty {
    (if (and ui.layout-target (not ui.measure-dirty))
      (ui.layout-target.component.arrange ui ui.layout-target)
      else (ui-arrange ui ui.root (vec4 0 0 width height) (vec4 0 0 width height)))
    (if ui.popup {
      (let anchor ui.popup.anchor.bounds)
      (let measured ui.popup.node.measured)
      (let x (clamp anchor.x 0 (max 0 (- width measured.x))))
      (let y (+ anchor.y anchor.w))
      (if (> (+ y measured.y) height) (set y (max 0 (- anchor.y measured.y))))
      (ui-arrange ui ui.popup.node (vec4 x y measured) (vec4 0 0 width height))
    })
    (set ui.measure-dirty false)
    (set ui.layout-dirty false)
    (set ui.layout-target nil)
    (ui-update-cursor ui)
  })
  (if (not ui.dirty) (return))
  (clear ui.background)
  (ui-paint ui ui.root context)
  (if ui.popup (ui-paint ui ui.popup.node context))
  (set ui.dirty false)))
