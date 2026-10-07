;shader function for painting an image onto the context
(let draw-image (sh (image:texture2d) {
  (return (blend (sample image)))
}))

; render callback
(on render (context) {
  (clear)

  (let n 10)
  ; (text) produces a texture by using a tiny layout engine and drawing to a standard canvas
  (let label (text 
    (resolution double); use double pixel density for cleaner text

    (height 160) ; use a fixed height to center the text vertically
    (v-align center) ; center the text vertically

    ; this is the cool part, emit layout tokens from inside of the for loop dynamically
    (for i n..0 {
      
      (fill (/ i n) 0 0); set the fill color
      (size (+ (* i 10) 1)); set the font size
      (offset (vec2 0 (* 10 (sin (+ context.t i))))); offset the next span by this amount

      "A"; naked strings are interpreted as a (span)

    })
  ))

  (draw-image context label.texture)
})