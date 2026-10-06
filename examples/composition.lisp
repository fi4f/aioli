(let gradient (sh ()
  (return (vec4 (/ p (vec2 w h)) 0.4 1))))

(let tint (sh (image : texture2d color : vec4)
  (return (* (sample image (/ p (vec2 w h))) color))))

(on render (context)
  (tint context (gradient context) (vec4 0.5 1 0.25 1)))
