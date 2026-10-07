(let gradient (sh ()
  (return (vec4f (/ p (vec2f w h)) 0.4 1))))

(let tint (sh (image : texture2d color : vec4f)
  (return (* (sample image (/ p (vec2f w h))) color))))

(on render (context)
  (tint context (gradient context) (vec4f 0.5 1 0.25 1)))
