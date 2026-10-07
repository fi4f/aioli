(on render (context)
  ((sh ()
    (let uv (/ p (vec2f w h)))
    (return (vec4f uv 0 1))) context))
