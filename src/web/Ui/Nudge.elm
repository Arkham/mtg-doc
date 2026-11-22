module Ui.Nudge exposing (Nudge, attribute, initial, next)

{-| Asking a custom element to do something again: focus its target, close its menu. It acts each
time the value it's given changes, so a page keeps a Nudge and moves it on when it wants that.
-}

import Html exposing (Attribute)
import Html.Attributes


type Nudge
    = Nudge Int


initial : Nudge
initial =
    Nudge 0


next : Nudge -> Nudge
next (Nudge n) =
    Nudge (n + 1)


{-| The element's attribute that hears the nudge, e.g. `token` for mtg-focus.
-}
attribute : String -> Nudge -> Attribute msg
attribute name (Nudge n) =
    Html.Attributes.attribute name (String.fromInt n)
