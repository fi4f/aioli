; Read-only captures are copied at each call; written captures share the variable.
(let draw (sh ()
  (let tint (vec3f 1 0.5 0.25))
  (let gain 0.25)

  (let shade (fn () (vec4f (* tint gain) 1)))
  (let brighten (fn () (set gain (+ gain 0.25))))
  (let apply (fn ()
    (brighten)
    (shade)))

  (apply)))

(on render (context) (draw context))
