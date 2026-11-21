module Types exposing
    ( AppConfig
    , BracketAssessment
    , BracketAssessmentPosition(..)
    , BracketCheck
    , BracketCombo
    , BracketReport
    , BracketReportExcluded
    , BracketReportGameChangerOption
    , Card
    , CardPreview
    , Color(..)
    , ColorStat
    , ColorStatHeaviestCard
    , ColorStatTargetReason(..)
    , Combo
    , DeckChange
    , DeckChangeAction(..)
    , DeckChatMessage
    , DeckChatMessageRole(..)
    , DeckDetail
    , DeckDetailMeta
    , DeckEdit
    , DeckEditChange
    , DeckEditChangeAction(..)
    , DeckEditTarget(..)
    , DeckEntry
    , DeckSnapshot
    , DeckStatus
    , DeckSummary
    , DecklistCard
    , EditStatus
    , EditStatusState(..)
    , EditTarget(..)
    , Job
    , JobStatus(..)
    , JobStep
    , JobStepStatus(..)
    , ManaReport
    , ManaSuggestion
    , OptimizeOptions
    , PlayGuide
    , PlayGuideKeyCard
    , Recognition
    , RecognitionJob
    , RecognitionJobStatus(..)
    , RecognitionResult
    , RecognitionResultFormat(..)
    , RecognizedEntry
    , RecognizedEntryStatus(..)
    , Report
    , ReportEdhrec
    , ReportHowToPlay
    , ReportOriginal
    , RerunOptions
    , RerunProposal
    , Research
    , ResearchSource
    , ResolvedName
    , ResolvedNameStatus(..)
    , Role(..)
    , RoleCount
    , SaveDeckRequest
    , SaveDeckRequestFormat(..)
    , Service(..)
    , SimResult
    , SimResultCombo
    , Swap
    , SwapAlternative
    , SwapCategory(..)
    , Synergy
    , Tone(..)
    , Trace
    , TraceRequest
    , TraceTask
    , TraceTaskState(..)
    , appConfigDecoder
    , bracketAssessmentDecoder
    , bracketAssessmentPositionDecoder
    , bracketAssessmentPositionFromString
    , bracketAssessmentPositionToString
    , bracketCheckDecoder
    , bracketComboDecoder
    , bracketReportDecoder
    , bracketReportExcludedDecoder
    , bracketReportGameChangerOptionDecoder
    , cardDecoder
    , cardPreviewDecoder
    , colorDecoder
    , colorFromString
    , colorStatDecoder
    , colorStatHeaviestCardDecoder
    , colorStatTargetReasonDecoder
    , colorStatTargetReasonFromString
    , colorStatTargetReasonToString
    , colorToString
    , comboDecoder
    , deckChangeActionDecoder
    , deckChangeActionFromString
    , deckChangeActionToString
    , deckChangeDecoder
    , deckChatMessageDecoder
    , deckChatMessageRoleDecoder
    , deckChatMessageRoleFromString
    , deckChatMessageRoleToString
    , deckDetailDecoder
    , deckDetailMetaDecoder
    , deckEditChangeActionDecoder
    , deckEditChangeActionFromString
    , deckEditChangeActionToString
    , deckEditChangeDecoder
    , deckEditDecoder
    , deckEditTargetDecoder
    , deckEditTargetFromString
    , deckEditTargetToString
    , deckEntryDecoder
    , deckSnapshotDecoder
    , deckStatusDecoder
    , deckSummaryDecoder
    , decklistCardDecoder
    , editStatusDecoder
    , editStatusStateDecoder
    , editStatusStateFromString
    , editStatusStateToString
    , editTargetDecoder
    , editTargetFromString
    , editTargetToString
    , encodeAppConfig
    , encodeBracketAssessment
    , encodeBracketAssessmentPosition
    , encodeBracketCheck
    , encodeBracketCombo
    , encodeBracketReport
    , encodeBracketReportExcluded
    , encodeBracketReportGameChangerOption
    , encodeCard
    , encodeCardPreview
    , encodeColor
    , encodeColorStat
    , encodeColorStatHeaviestCard
    , encodeColorStatTargetReason
    , encodeCombo
    , encodeDeckChange
    , encodeDeckChangeAction
    , encodeDeckChatMessage
    , encodeDeckChatMessageRole
    , encodeDeckDetail
    , encodeDeckDetailMeta
    , encodeDeckEdit
    , encodeDeckEditChange
    , encodeDeckEditChangeAction
    , encodeDeckEditTarget
    , encodeDeckEntry
    , encodeDeckSnapshot
    , encodeDeckStatus
    , encodeDeckSummary
    , encodeDecklistCard
    , encodeEditStatus
    , encodeEditStatusState
    , encodeEditTarget
    , encodeJob
    , encodeJobStatus
    , encodeJobStep
    , encodeJobStepStatus
    , encodeManaReport
    , encodeManaSuggestion
    , encodeOptimizeOptions
    , encodePlayGuide
    , encodePlayGuideKeyCard
    , encodeRecognition
    , encodeRecognitionJob
    , encodeRecognitionJobStatus
    , encodeRecognitionResult
    , encodeRecognitionResultFormat
    , encodeRecognizedEntry
    , encodeRecognizedEntryStatus
    , encodeReport
    , encodeReportEdhrec
    , encodeReportHowToPlay
    , encodeReportOriginal
    , encodeRerunOptions
    , encodeRerunProposal
    , encodeResearch
    , encodeResearchSource
    , encodeResolvedName
    , encodeResolvedNameStatus
    , encodeRole
    , encodeRoleCount
    , encodeSaveDeckRequest
    , encodeSaveDeckRequestFormat
    , encodeService
    , encodeSimResult
    , encodeSimResultCombo
    , encodeSwap
    , encodeSwapAlternative
    , encodeSwapCategory
    , encodeSynergy
    , encodeTone
    , encodeTrace
    , encodeTraceRequest
    , encodeTraceTask
    , encodeTraceTaskState
    , jobDecoder
    , jobStatusDecoder
    , jobStatusFromString
    , jobStatusToString
    , jobStepDecoder
    , jobStepStatusDecoder
    , jobStepStatusFromString
    , jobStepStatusToString
    , manaReportDecoder
    , manaSuggestionDecoder
    , optimizeOptionsDecoder
    , playGuideDecoder
    , playGuideKeyCardDecoder
    , recognitionDecoder
    , recognitionJobDecoder
    , recognitionJobStatusDecoder
    , recognitionJobStatusFromString
    , recognitionJobStatusToString
    , recognitionResultDecoder
    , recognitionResultFormatDecoder
    , recognitionResultFormatFromString
    , recognitionResultFormatToString
    , recognizedEntryDecoder
    , recognizedEntryStatusDecoder
    , recognizedEntryStatusFromString
    , recognizedEntryStatusToString
    , reportDecoder
    , reportEdhrecDecoder
    , reportHowToPlayDecoder
    , reportOriginalDecoder
    , rerunOptionsDecoder
    , rerunProposalDecoder
    , researchDecoder
    , researchSourceDecoder
    , resolvedNameDecoder
    , resolvedNameStatusDecoder
    , resolvedNameStatusFromString
    , resolvedNameStatusToString
    , roleCountDecoder
    , roleDecoder
    , roleFromString
    , roleToString
    , saveDeckRequestDecoder
    , saveDeckRequestFormatDecoder
    , saveDeckRequestFormatFromString
    , saveDeckRequestFormatToString
    , serviceDecoder
    , serviceFromString
    , serviceToString
    , simResultComboDecoder
    , simResultDecoder
    , swapAlternativeDecoder
    , swapCategoryDecoder
    , swapCategoryFromString
    , swapCategoryToString
    , swapDecoder
    , synergyDecoder
    , toneDecoder
    , toneFromString
    , toneToString
    , traceDecoder
    , traceRequestDecoder
    , traceTaskDecoder
    , traceTaskStateDecoder
    , traceTaskStateFromString
    , traceTaskStateToString
    )

{-| Generated by scripts/gen-elm.ts from shared/types.ts. Do not edit by hand.
-}

import Dict exposing (Dict)
import Json.Decode as D exposing (Decoder)
import Json.Decode.Pipeline as P
import Json.Encode as E


type alias AppConfig =
    { llm : Bool
    , model : String
    , visionModel : String
    , webResearch : Bool
    }


appConfigDecoder : Decoder AppConfig
appConfigDecoder =
    D.succeed AppConfig
        |> P.required "llm" D.bool
        |> P.required "model" D.string
        |> P.required "visionModel" D.string
        |> P.required "webResearch" D.bool


encodeAppConfig : AppConfig -> E.Value
encodeAppConfig value =
    E.object
        (List.filterMap identity
            [ Just ( "llm", E.bool value.llm )
            , Just ( "model", E.string value.model )
            , Just ( "visionModel", E.string value.visionModel )
            , Just ( "webResearch", E.bool value.webResearch )
            ]
        )


{-| bracket: Lowest bracket whose rules the deck satisfies.

power: 0-100 heuristic power estimate.

position: Where the deck sits inside the target bracket.

-}
type alias BracketAssessment =
    { bracket : Float
    , spellbookTag : Maybe String
    , gameChangers : List String
    , massLandDenial : List String
    , extraTurns : List String
    , combos : List BracketCombo
    , power : Float
    , position : BracketAssessmentPosition
    , checks : List BracketCheck
    }


bracketAssessmentDecoder : Decoder BracketAssessment
bracketAssessmentDecoder =
    D.succeed BracketAssessment
        |> P.required "bracket" D.float
        |> P.required "spellbookTag" (D.nullable D.string)
        |> P.required "gameChangers" (D.list D.string)
        |> P.required "massLandDenial" (D.list D.string)
        |> P.required "extraTurns" (D.list D.string)
        |> P.required "combos" (D.list bracketComboDecoder)
        |> P.required "power" D.float
        |> P.required "position" bracketAssessmentPositionDecoder
        |> P.required "checks" (D.list bracketCheckDecoder)


encodeBracketAssessment : BracketAssessment -> E.Value
encodeBracketAssessment value =
    E.object
        (List.filterMap identity
            [ Just ( "bracket", E.float value.bracket )
            , Just ( "spellbookTag", Maybe.withDefault E.null (Maybe.map E.string value.spellbookTag) )
            , Just ( "gameChangers", E.list E.string value.gameChangers )
            , Just ( "massLandDenial", E.list E.string value.massLandDenial )
            , Just ( "extraTurns", E.list E.string value.extraTurns )
            , Just ( "combos", E.list encodeBracketCombo value.combos )
            , Just ( "power", E.float value.power )
            , Just ( "position", encodeBracketAssessmentPosition value.position )
            , Just ( "checks", E.list encodeBracketCheck value.checks )
            ]
        )


type BracketAssessmentPosition
    = BracketAssessmentPositionLow
    | BracketAssessmentPositionMid
    | BracketAssessmentPositionHigh


bracketAssessmentPositionToString : BracketAssessmentPosition -> String
bracketAssessmentPositionToString value =
    case value of
        BracketAssessmentPositionLow ->
            "low"

        BracketAssessmentPositionMid ->
            "mid"

        BracketAssessmentPositionHigh ->
            "high"


bracketAssessmentPositionFromString : String -> Maybe BracketAssessmentPosition
bracketAssessmentPositionFromString value =
    case value of
        "low" ->
            Just BracketAssessmentPositionLow

        "mid" ->
            Just BracketAssessmentPositionMid

        "high" ->
            Just BracketAssessmentPositionHigh

        _ ->
            Nothing


bracketAssessmentPositionDecoder : Decoder BracketAssessmentPosition
bracketAssessmentPositionDecoder =
    D.string
        |> D.andThen
            (\value ->
                case bracketAssessmentPositionFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown BracketAssessmentPosition: " ++ value)
            )


encodeBracketAssessmentPosition : BracketAssessmentPosition -> E.Value
encodeBracketAssessmentPosition =
    bracketAssessmentPositionToString >> E.string


type alias BracketCheck =
    { label : String
    , ok : Bool
    , detail : String
    }


bracketCheckDecoder : Decoder BracketCheck
bracketCheckDecoder =
    D.succeed BracketCheck
        |> P.required "label" D.string
        |> P.required "ok" D.bool
        |> P.required "detail" D.string


encodeBracketCheck : BracketCheck -> E.Value
encodeBracketCheck value =
    E.object
        (List.filterMap identity
            [ Just ( "label", E.string value.label )
            , Just ( "ok", E.bool value.ok )
            , Just ( "detail", E.string value.detail )
            ]
        )


{-| earlyPct: % of goldfish games assembled before the bracket's minimum game length.
-}
type alias BracketCombo =
    { cards : List String
    , produces : List String
    , twoCard : Bool
    , tag : Maybe String
    , earlyPct : Maybe Float
    , url : String
    }


bracketComboDecoder : Decoder BracketCombo
bracketComboDecoder =
    D.succeed BracketCombo
        |> P.required "cards" (D.list D.string)
        |> P.required "produces" (D.list D.string)
        |> P.required "twoCard" D.bool
        |> P.required "tag" (D.nullable D.string)
        |> P.required "earlyPct" (D.nullable D.float)
        |> P.required "url" D.string


encodeBracketCombo : BracketCombo -> E.Value
encodeBracketCombo value =
    E.object
        (List.filterMap identity
            [ Just ( "cards", E.list E.string value.cards )
            , Just ( "produces", E.list E.string value.produces )
            , Just ( "twoCard", E.bool value.twoCard )
            , Just ( "tag", Maybe.withDefault E.null (Maybe.map E.string value.tag) )
            , Just ( "earlyPct", Maybe.withDefault E.null (Maybe.map E.float value.earlyPct) )
            , Just ( "url", E.string value.url )
            ]
        )


{-| gameChangerOptions: Best Game Changers not in the deck, for brackets with free slots.

excluded: Strong cards the optimizer skipped to stay in the bracket.

-}
type alias BracketReport =
    { target : Float
    , name : String
    , minTurns : Float
    , tone : Tone
    , before : BracketAssessment
    , after : BracketAssessment
    , gameChangerLimit : Maybe Float
    , gameChangerOptions : List BracketReportGameChangerOption
    , excluded : List BracketReportExcluded
    }


bracketReportDecoder : Decoder BracketReport
bracketReportDecoder =
    D.succeed BracketReport
        |> P.required "target" D.float
        |> P.required "name" D.string
        |> P.required "minTurns" D.float
        |> P.required "tone" toneDecoder
        |> P.required "before" bracketAssessmentDecoder
        |> P.required "after" bracketAssessmentDecoder
        |> P.required "gameChangerLimit" (D.nullable D.float)
        |> P.required "gameChangerOptions" (D.list bracketReportGameChangerOptionDecoder)
        |> P.required "excluded" (D.list bracketReportExcludedDecoder)


encodeBracketReport : BracketReport -> E.Value
encodeBracketReport value =
    E.object
        (List.filterMap identity
            [ Just ( "target", E.float value.target )
            , Just ( "name", E.string value.name )
            , Just ( "minTurns", E.float value.minTurns )
            , Just ( "tone", encodeTone value.tone )
            , Just ( "before", encodeBracketAssessment value.before )
            , Just ( "after", encodeBracketAssessment value.after )
            , Just ( "gameChangerLimit", Maybe.withDefault E.null (Maybe.map E.float value.gameChangerLimit) )
            , Just ( "gameChangerOptions", E.list encodeBracketReportGameChangerOption value.gameChangerOptions )
            , Just ( "excluded", E.list encodeBracketReportExcluded value.excluded )
            ]
        )


type alias BracketReportExcluded =
    { name : String
    , reason : String
    }


bracketReportExcludedDecoder : Decoder BracketReportExcluded
bracketReportExcludedDecoder =
    D.succeed BracketReportExcluded
        |> P.required "name" D.string
        |> P.required "reason" D.string


encodeBracketReportExcluded : BracketReportExcluded -> E.Value
encodeBracketReportExcluded value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Just ( "reason", E.string value.reason )
            ]
        )


type alias BracketReportGameChangerOption =
    { name : String
    , score : Float
    , inDeck : Bool
    }


bracketReportGameChangerOptionDecoder : Decoder BracketReportGameChangerOption
bracketReportGameChangerOptionDecoder =
    D.succeed BracketReportGameChangerOption
        |> P.required "name" D.string
        |> P.required "score" D.float
        |> P.required "inDeck" D.bool


encodeBracketReportGameChangerOption : BracketReportGameChangerOption -> E.Value
encodeBracketReportGameChangerOption value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Just ( "score", E.float value.score )
            , Just ( "inDeck", E.bool value.inDeck )
            ]
        )


{-| isMdfcLand: Front face is a spell but the back face is a land (MDFC).
-}
type alias Card =
    { name : String
    , oracleId : String
    , manaCost : String
    , cmc : Float
    , typeLine : String
    , oracleText : String
    , colors : List Color
    , colorIdentity : List Color
    , producedMana : List String
    , isLand : Bool
    , isMdfcLand : Bool
    , entersTapped : Bool
    , legalCommander : Bool
    , canBeCommander : Bool
    , gameChanger : Bool
    , priceUsd : Maybe Float
    , power : Maybe String
    , toughness : Maybe String
    , loyalty : Maybe String
    , image : Maybe String
    , imageArt : Maybe String
    , scryfallUri : String
    , roles : List Role
    }


cardDecoder : Decoder Card
cardDecoder =
    D.succeed Card
        |> P.required "name" D.string
        |> P.required "oracleId" D.string
        |> P.required "manaCost" D.string
        |> P.required "cmc" D.float
        |> P.required "typeLine" D.string
        |> P.required "oracleText" D.string
        |> P.required "colors" (D.list colorDecoder)
        |> P.required "colorIdentity" (D.list colorDecoder)
        |> P.required "producedMana" (D.list D.string)
        |> P.required "isLand" D.bool
        |> P.required "isMdfcLand" D.bool
        |> P.required "entersTapped" D.bool
        |> P.required "legalCommander" D.bool
        |> P.required "canBeCommander" D.bool
        |> P.required "gameChanger" D.bool
        |> P.required "priceUsd" (D.nullable D.float)
        |> P.optional "power" (D.map Just D.string) Nothing
        |> P.optional "toughness" (D.map Just D.string) Nothing
        |> P.optional "loyalty" (D.map Just D.string) Nothing
        |> P.required "image" (D.nullable D.string)
        |> P.required "imageArt" (D.nullable D.string)
        |> P.required "scryfallUri" D.string
        |> P.required "roles" (D.list roleDecoder)


encodeCard : Card -> E.Value
encodeCard value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Just ( "oracleId", E.string value.oracleId )
            , Just ( "manaCost", E.string value.manaCost )
            , Just ( "cmc", E.float value.cmc )
            , Just ( "typeLine", E.string value.typeLine )
            , Just ( "oracleText", E.string value.oracleText )
            , Just ( "colors", E.list encodeColor value.colors )
            , Just ( "colorIdentity", E.list encodeColor value.colorIdentity )
            , Just ( "producedMana", E.list E.string value.producedMana )
            , Just ( "isLand", E.bool value.isLand )
            , Just ( "isMdfcLand", E.bool value.isMdfcLand )
            , Just ( "entersTapped", E.bool value.entersTapped )
            , Just ( "legalCommander", E.bool value.legalCommander )
            , Just ( "canBeCommander", E.bool value.canBeCommander )
            , Just ( "gameChanger", E.bool value.gameChanger )
            , Just ( "priceUsd", Maybe.withDefault E.null (Maybe.map E.float value.priceUsd) )
            , Maybe.map (\v -> ( "power", E.string v )) value.power
            , Maybe.map (\v -> ( "toughness", E.string v )) value.toughness
            , Maybe.map (\v -> ( "loyalty", E.string v )) value.loyalty
            , Just ( "image", Maybe.withDefault E.null (Maybe.map E.string value.image) )
            , Just ( "imageArt", Maybe.withDefault E.null (Maybe.map E.string value.imageArt) )
            , Just ( "scryfallUri", E.string value.scryfallUri )
            , Just ( "roles", E.list encodeRole value.roles )
            ]
        )


type alias CardPreview =
    { image : Maybe String
    , scryfallUri : String
    , priceUsd : Maybe Float
    }


cardPreviewDecoder : Decoder CardPreview
cardPreviewDecoder =
    D.succeed CardPreview
        |> P.required "image" (D.nullable D.string)
        |> P.required "scryfallUri" D.string
        |> P.optional "priceUsd" (D.map Just D.float) Nothing


encodeCardPreview : CardPreview -> E.Value
encodeCardPreview value =
    E.object
        (List.filterMap identity
            [ Just ( "image", Maybe.withDefault E.null (Maybe.map E.string value.image) )
            , Just ( "scryfallUri", E.string value.scryfallUri )
            , Maybe.map (\v -> ( "priceUsd", E.float v )) value.priceUsd
            ]
        )


type Color
    = ColorW
    | ColorU
    | ColorB
    | ColorR
    | ColorG


colorToString : Color -> String
colorToString value =
    case value of
        ColorW ->
            "W"

        ColorU ->
            "U"

        ColorB ->
            "B"

        ColorR ->
            "R"

        ColorG ->
            "G"


colorFromString : String -> Maybe Color
colorFromString value =
    case value of
        "W" ->
            Just ColorW

        "U" ->
            Just ColorU

        "B" ->
            Just ColorB

        "R" ->
            Just ColorR

        "G" ->
            Just ColorG

        _ ->
            Nothing


colorDecoder : Decoder Color
colorDecoder =
    D.string
        |> D.andThen
            (\value ->
                case colorFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown Color: " ++ value)
            )


encodeColor : Color -> E.Value
encodeColor =
    colorToString >> E.string


{-| targetReason: What sets the target: one card's heavy cost in this color, or the color's overall share.

heaviestCard: The spell needing the most symbols of this color, with its cost.

-}
type alias ColorStat =
    { color : Color
    , pips : Float
    , pipShare : Float
    , landSources : Float
    , rampSources : Float
    , targetSources : Float
    , targetReason : Maybe ColorStatTargetReason
    , heaviestCard : Maybe ColorStatHeaviestCard
    }


colorStatDecoder : Decoder ColorStat
colorStatDecoder =
    D.succeed ColorStat
        |> P.required "color" colorDecoder
        |> P.required "pips" D.float
        |> P.required "pipShare" D.float
        |> P.required "landSources" D.float
        |> P.required "rampSources" D.float
        |> P.required "targetSources" D.float
        |> P.optional "targetReason" (D.map Just colorStatTargetReasonDecoder) Nothing
        |> P.optional "heaviestCard" (D.map Just colorStatHeaviestCardDecoder) Nothing


encodeColorStat : ColorStat -> E.Value
encodeColorStat value =
    E.object
        (List.filterMap identity
            [ Just ( "color", encodeColor value.color )
            , Just ( "pips", E.float value.pips )
            , Just ( "pipShare", E.float value.pipShare )
            , Just ( "landSources", E.float value.landSources )
            , Just ( "rampSources", E.float value.rampSources )
            , Just ( "targetSources", E.float value.targetSources )
            , Maybe.map (\v -> ( "targetReason", encodeColorStatTargetReason v )) value.targetReason
            , Maybe.map (\v -> ( "heaviestCard", encodeColorStatHeaviestCard v )) value.heaviestCard
            ]
        )


type alias ColorStatHeaviestCard =
    { name : String
    , manaCost : String
    }


colorStatHeaviestCardDecoder : Decoder ColorStatHeaviestCard
colorStatHeaviestCardDecoder =
    D.succeed ColorStatHeaviestCard
        |> P.required "name" D.string
        |> P.required "manaCost" D.string


encodeColorStatHeaviestCard : ColorStatHeaviestCard -> E.Value
encodeColorStatHeaviestCard value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Just ( "manaCost", E.string value.manaCost )
            ]
        )


type ColorStatTargetReason
    = ColorStatTargetReasonHeaviestCard
    | ColorStatTargetReasonShare


colorStatTargetReasonToString : ColorStatTargetReason -> String
colorStatTargetReasonToString value =
    case value of
        ColorStatTargetReasonHeaviestCard ->
            "heaviest-card"

        ColorStatTargetReasonShare ->
            "share"


colorStatTargetReasonFromString : String -> Maybe ColorStatTargetReason
colorStatTargetReasonFromString value =
    case value of
        "heaviest-card" ->
            Just ColorStatTargetReasonHeaviestCard

        "share" ->
            Just ColorStatTargetReasonShare

        _ ->
            Nothing


colorStatTargetReasonDecoder : Decoder ColorStatTargetReason
colorStatTargetReasonDecoder =
    D.string
        |> D.andThen
            (\value ->
                case colorStatTargetReasonFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown ColorStatTargetReason: " ++ value)
            )


encodeColorStatTargetReason : ColorStatTargetReason -> E.Value
encodeColorStatTargetReason =
    colorStatTargetReasonToString >> E.string


type alias Combo =
    { id : String
    , cards : List String
    , missing : List String
    , produces : List String
    , description : String
    , bracketTag : Maybe String
    , url : String
    }


comboDecoder : Decoder Combo
comboDecoder =
    D.succeed Combo
        |> P.required "id" D.string
        |> P.required "cards" (D.list D.string)
        |> P.required "missing" (D.list D.string)
        |> P.required "produces" (D.list D.string)
        |> P.required "description" D.string
        |> P.required "bracketTag" (D.nullable D.string)
        |> P.required "url" D.string


encodeCombo : Combo -> E.Value
encodeCombo value =
    E.object
        (List.filterMap identity
            [ Just ( "id", E.string value.id )
            , Just ( "cards", E.list E.string value.cards )
            , Just ( "missing", E.list E.string value.missing )
            , Just ( "produces", E.list E.string value.produces )
            , Just ( "description", E.string value.description )
            , Just ( "bracketTag", Maybe.withDefault E.null (Maybe.map E.string value.bracketTag) )
            , Just ( "url", E.string value.url )
            ]
        )


{-| problem: Why the change can't be applied, when `ok` is false.
-}
type alias DeckChange =
    { action : DeckChangeAction
    , name : String
    , qty : Float
    , reason : String
    , ok : Bool
    , problem : Maybe String
    , card : Maybe Card
    }


deckChangeDecoder : Decoder DeckChange
deckChangeDecoder =
    D.succeed DeckChange
        |> P.required "action" deckChangeActionDecoder
        |> P.required "name" D.string
        |> P.required "qty" D.float
        |> P.required "reason" D.string
        |> P.required "ok" D.bool
        |> P.optional "problem" (D.map Just D.string) Nothing
        |> P.optional "card" (D.map Just cardDecoder) Nothing


encodeDeckChange : DeckChange -> E.Value
encodeDeckChange value =
    E.object
        (List.filterMap identity
            [ Just ( "action", encodeDeckChangeAction value.action )
            , Just ( "name", E.string value.name )
            , Just ( "qty", E.float value.qty )
            , Just ( "reason", E.string value.reason )
            , Just ( "ok", E.bool value.ok )
            , Maybe.map (\v -> ( "problem", E.string v )) value.problem
            , Maybe.map (\v -> ( "card", encodeCard v )) value.card
            ]
        )


type DeckChangeAction
    = DeckChangeActionAdd
    | DeckChangeActionRemove


deckChangeActionToString : DeckChangeAction -> String
deckChangeActionToString value =
    case value of
        DeckChangeActionAdd ->
            "add"

        DeckChangeActionRemove ->
            "remove"


deckChangeActionFromString : String -> Maybe DeckChangeAction
deckChangeActionFromString value =
    case value of
        "add" ->
            Just DeckChangeActionAdd

        "remove" ->
            Just DeckChangeActionRemove

        _ ->
            Nothing


deckChangeActionDecoder : Decoder DeckChangeAction
deckChangeActionDecoder =
    D.string
        |> D.andThen
            (\value ->
                case deckChangeActionFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown DeckChangeAction: " ++ value)
            )


encodeDeckChangeAction : DeckChangeAction -> E.Value
encodeDeckChangeAction =
    deckChangeActionToString >> E.string


{-| applying: The changes are being made in the background; `applied` or `applyError` follows.

applyError: Why applying the changes failed, when it did.

target: The list `changes` edit: the one on screen, unless the user asked to change the other.

reportUpdated: The doc changed the report directly (e.g. found synergies again); the client reloads it.

-}
type alias DeckChatMessage =
    { id : String
    , role : DeckChatMessageRole
    , content : String
    , at : String
    , changes : Maybe (List DeckChange)
    , applied : Maybe Bool
    , applying : Maybe Bool
    , applyError : Maybe String
    , rerun : Maybe RerunProposal
    , target : Maybe EditTarget
    , reportUpdated : Maybe Bool
    }


deckChatMessageDecoder : Decoder DeckChatMessage
deckChatMessageDecoder =
    D.succeed DeckChatMessage
        |> P.required "id" D.string
        |> P.required "role" deckChatMessageRoleDecoder
        |> P.required "content" D.string
        |> P.required "at" D.string
        |> P.optional "changes" (D.map Just (D.list deckChangeDecoder)) Nothing
        |> P.optional "applied" (D.map Just D.bool) Nothing
        |> P.optional "applying" (D.map Just D.bool) Nothing
        |> P.optional "applyError" (D.map Just D.string) Nothing
        |> P.optional "rerun" (D.map Just rerunProposalDecoder) Nothing
        |> P.optional "target" (D.map Just editTargetDecoder) Nothing
        |> P.optional "reportUpdated" (D.map Just D.bool) Nothing


encodeDeckChatMessage : DeckChatMessage -> E.Value
encodeDeckChatMessage value =
    E.object
        (List.filterMap identity
            [ Just ( "id", E.string value.id )
            , Just ( "role", encodeDeckChatMessageRole value.role )
            , Just ( "content", E.string value.content )
            , Just ( "at", E.string value.at )
            , Maybe.map (\v -> ( "changes", E.list encodeDeckChange v )) value.changes
            , Maybe.map (\v -> ( "applied", E.bool v )) value.applied
            , Maybe.map (\v -> ( "applying", E.bool v )) value.applying
            , Maybe.map (\v -> ( "applyError", E.string v )) value.applyError
            , Maybe.map (\v -> ( "rerun", encodeRerunProposal v )) value.rerun
            , Maybe.map (\v -> ( "target", encodeEditTarget v )) value.target
            , Maybe.map (\v -> ( "reportUpdated", E.bool v )) value.reportUpdated
            ]
        )


type DeckChatMessageRole
    = DeckChatMessageRoleUser
    | DeckChatMessageRoleAssistant


deckChatMessageRoleToString : DeckChatMessageRole -> String
deckChatMessageRoleToString value =
    case value of
        DeckChatMessageRoleUser ->
            "user"

        DeckChatMessageRoleAssistant ->
            "assistant"


deckChatMessageRoleFromString : String -> Maybe DeckChatMessageRole
deckChatMessageRoleFromString value =
    case value of
        "user" ->
            Just DeckChatMessageRoleUser

        "assistant" ->
            Just DeckChatMessageRoleAssistant

        _ ->
            Nothing


deckChatMessageRoleDecoder : Decoder DeckChatMessageRole
deckChatMessageRoleDecoder =
    D.string
        |> D.andThen
            (\value ->
                case deckChatMessageRoleFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown DeckChatMessageRole: " ++ value)
            )


encodeDeckChatMessageRole : DeckChatMessageRole -> E.Value
encodeDeckChatMessageRole =
    deckChatMessageRoleToString >> E.string


{-| updating: Edits are still being made in the background; the report updates when they're in.

refreshInMs: Edits are in; their slower parts (combos, synergies...) are worked out in this long.

refreshing: Those slower parts are being worked out now.

savedAt: When the report was last saved (ms since the epoch): it changed if this did.

-}
type alias DeckDetail =
    { updating : Maybe Bool
    , refreshInMs : Maybe Float
    , refreshing : Maybe Bool
    , savedAt : Maybe Float
    , meta : DeckDetailMeta
    , report : Maybe Report
    , initial : String
    }


deckDetailDecoder : Decoder DeckDetail
deckDetailDecoder =
    D.succeed DeckDetail
        |> P.optional "updating" (D.map Just D.bool) Nothing
        |> P.optional "refreshInMs" (D.map Just D.float) Nothing
        |> P.optional "refreshing" (D.map Just D.bool) Nothing
        |> P.optional "savedAt" (D.map Just D.float) Nothing
        |> P.required "meta" deckDetailMetaDecoder
        |> P.required "report" (D.nullable reportDecoder)
        |> P.required "initial" D.string


encodeDeckDetail : DeckDetail -> E.Value
encodeDeckDetail value =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "updating", E.bool v )) value.updating
            , Maybe.map (\v -> ( "refreshInMs", E.float v )) value.refreshInMs
            , Maybe.map (\v -> ( "refreshing", E.bool v )) value.refreshing
            , Maybe.map (\v -> ( "savedAt", E.float v )) value.savedAt
            , Just ( "meta", encodeDeckDetailMeta value.meta )
            , Just ( "report", Maybe.withDefault E.null (Maybe.map encodeReport value.report) )
            , Just ( "initial", E.string value.initial )
            ]
        )


type alias DeckDetailMeta =
    { slug : String
    , format : String
    , commanders : List String
    , options : OptimizeOptions
    , createdAt : String
    , hideSuggestions : Maybe Bool
    }


deckDetailMetaDecoder : Decoder DeckDetailMeta
deckDetailMetaDecoder =
    D.succeed DeckDetailMeta
        |> P.required "slug" D.string
        |> P.required "format" D.string
        |> P.required "commanders" (D.list D.string)
        |> P.required "options" optimizeOptionsDecoder
        |> P.required "createdAt" D.string
        |> P.optional "hideSuggestions" (D.map Just D.bool) Nothing


encodeDeckDetailMeta : DeckDetailMeta -> E.Value
encodeDeckDetailMeta value =
    E.object
        (List.filterMap identity
            [ Just ( "slug", E.string value.slug )
            , Just ( "format", E.string value.format )
            , Just ( "commanders", E.list E.string value.commanders )
            , Just ( "options", encodeOptimizeOptions value.options )
            , Just ( "createdAt", E.string value.createdAt )
            , Maybe.map (\v -> ( "hideSuggestions", E.bool v )) value.hideSuggestions
            ]
        )


{-| target: Set when the edit changed the deck as submitted; the suggestions were rebuilt from it.
-}
type alias DeckEdit =
    { at : String
    , request : String
    , target : Maybe DeckEditTarget
    , changes : List DeckEditChange
    }


deckEditDecoder : Decoder DeckEdit
deckEditDecoder =
    D.succeed DeckEdit
        |> P.required "at" D.string
        |> P.required "request" D.string
        |> P.optional "target" (D.map Just deckEditTargetDecoder) Nothing
        |> P.required "changes" (D.list deckEditChangeDecoder)


encodeDeckEdit : DeckEdit -> E.Value
encodeDeckEdit value =
    E.object
        (List.filterMap identity
            [ Just ( "at", E.string value.at )
            , Just ( "request", E.string value.request )
            , Maybe.map (\v -> ( "target", encodeDeckEditTarget v )) value.target
            , Just ( "changes", E.list encodeDeckEditChange value.changes )
            ]
        )


type alias DeckEditChange =
    { action : DeckEditChangeAction
    , name : String
    , qty : Float
    , reason : String
    }


deckEditChangeDecoder : Decoder DeckEditChange
deckEditChangeDecoder =
    D.succeed DeckEditChange
        |> P.required "action" deckEditChangeActionDecoder
        |> P.required "name" D.string
        |> P.required "qty" D.float
        |> P.required "reason" D.string


encodeDeckEditChange : DeckEditChange -> E.Value
encodeDeckEditChange value =
    E.object
        (List.filterMap identity
            [ Just ( "action", encodeDeckEditChangeAction value.action )
            , Just ( "name", E.string value.name )
            , Just ( "qty", E.float value.qty )
            , Just ( "reason", E.string value.reason )
            ]
        )


type DeckEditChangeAction
    = DeckEditChangeActionAdd
    | DeckEditChangeActionRemove


deckEditChangeActionToString : DeckEditChangeAction -> String
deckEditChangeActionToString value =
    case value of
        DeckEditChangeActionAdd ->
            "add"

        DeckEditChangeActionRemove ->
            "remove"


deckEditChangeActionFromString : String -> Maybe DeckEditChangeAction
deckEditChangeActionFromString value =
    case value of
        "add" ->
            Just DeckEditChangeActionAdd

        "remove" ->
            Just DeckEditChangeActionRemove

        _ ->
            Nothing


deckEditChangeActionDecoder : Decoder DeckEditChangeAction
deckEditChangeActionDecoder =
    D.string
        |> D.andThen
            (\value ->
                case deckEditChangeActionFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown DeckEditChangeAction: " ++ value)
            )


encodeDeckEditChangeAction : DeckEditChangeAction -> E.Value
encodeDeckEditChangeAction =
    deckEditChangeActionToString >> E.string


type DeckEditTarget
    = DeckEditTargetOriginal


deckEditTargetToString : DeckEditTarget -> String
deckEditTargetToString value =
    case value of
        DeckEditTargetOriginal ->
            "original"


deckEditTargetFromString : String -> Maybe DeckEditTarget
deckEditTargetFromString value =
    case value of
        "original" ->
            Just DeckEditTargetOriginal

        _ ->
            Nothing


deckEditTargetDecoder : Decoder DeckEditTarget
deckEditTargetDecoder =
    D.string
        |> D.andThen
            (\value ->
                case deckEditTargetFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown DeckEditTarget: " ++ value)
            )


encodeDeckEditTarget : DeckEditTarget -> E.Value
encodeDeckEditTarget =
    deckEditTargetToString >> E.string


type alias DeckEntry =
    { qty : Float
    , name : String
    }


deckEntryDecoder : Decoder DeckEntry
deckEntryDecoder =
    D.succeed DeckEntry
        |> P.required "qty" D.float
        |> P.required "name" D.string


encodeDeckEntry : DeckEntry -> E.Value
encodeDeckEntry value =
    E.object
        (List.filterMap identity
            [ Just ( "qty", E.float value.qty )
            , Just ( "name", E.string value.name )
            ]
        )


{-| delta: Quantity change vs the initial list (basics can go up or down).
-}
type alias DecklistCard =
    { name : String
    , manaCost : Maybe String
    , qty : Float
    , group : String
    , cmc : Float
    , image : Maybe String
    , scryfallUri : String
    , priceUsd : Maybe Float
    , isNew : Bool
    , delta : Float
    }


decklistCardDecoder : Decoder DecklistCard
decklistCardDecoder =
    D.succeed DecklistCard
        |> P.required "name" D.string
        |> P.optional "manaCost" (D.map Just D.string) Nothing
        |> P.required "qty" D.float
        |> P.required "group" D.string
        |> P.required "cmc" D.float
        |> P.required "image" (D.nullable D.string)
        |> P.required "scryfallUri" D.string
        |> P.required "priceUsd" (D.nullable D.float)
        |> P.required "isNew" D.bool
        |> P.required "delta" D.float


encodeDecklistCard : DecklistCard -> E.Value
encodeDecklistCard value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Maybe.map (\v -> ( "manaCost", E.string v )) value.manaCost
            , Just ( "qty", E.float value.qty )
            , Just ( "group", E.string value.group )
            , Just ( "cmc", E.float value.cmc )
            , Just ( "image", Maybe.withDefault E.null (Maybe.map E.string value.image) )
            , Just ( "scryfallUri", E.string value.scryfallUri )
            , Just ( "priceUsd", Maybe.withDefault E.null (Maybe.map E.float value.priceUsd) )
            , Just ( "isNew", E.bool value.isNew )
            , Just ( "delta", E.float value.delta )
            ]
        )


type alias DeckSnapshot =
    { mana : ManaReport
    , sim : SimResult
    , roles : List RoleCount
    , totalCards : Float
    , totalPriceUsd : Float
    }


deckSnapshotDecoder : Decoder DeckSnapshot
deckSnapshotDecoder =
    D.succeed DeckSnapshot
        |> P.required "mana" manaReportDecoder
        |> P.required "sim" simResultDecoder
        |> P.required "roles" (D.list roleCountDecoder)
        |> P.required "totalCards" D.float
        |> P.required "totalPriceUsd" D.float


encodeDeckSnapshot : DeckSnapshot -> E.Value
encodeDeckSnapshot value =
    E.object
        (List.filterMap identity
            [ Just ( "mana", encodeManaReport value.mana )
            , Just ( "sim", encodeSimResult value.sim )
            , Just ( "roles", E.list encodeRoleCount value.roles )
            , Just ( "totalCards", E.float value.totalCards )
            , Just ( "totalPriceUsd", E.float value.totalPriceUsd )
            ]
        )


{-| updating: Edits are still being made in the background; the report updates when they're in.

refreshInMs: Edits are in; their slower parts (combos, synergies...) are worked out in this long.

refreshing: Those slower parts are being worked out now.

savedAt: When the report was last saved (ms since the epoch): it changed if this did.

-}
type alias DeckStatus =
    { updating : Maybe Bool
    , refreshInMs : Maybe Float
    , refreshing : Maybe Bool
    , savedAt : Maybe Float
    }


deckStatusDecoder : Decoder DeckStatus
deckStatusDecoder =
    D.succeed DeckStatus
        |> P.optional "updating" (D.map Just D.bool) Nothing
        |> P.optional "refreshInMs" (D.map Just D.float) Nothing
        |> P.optional "refreshing" (D.map Just D.bool) Nothing
        |> P.optional "savedAt" (D.map Just D.float) Nothing


encodeDeckStatus : DeckStatus -> E.Value
encodeDeckStatus value =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "updating", E.bool v )) value.updating
            , Maybe.map (\v -> ( "refreshInMs", E.float v )) value.refreshInMs
            , Maybe.map (\v -> ( "refreshing", E.bool v )) value.refreshing
            , Maybe.map (\v -> ( "savedAt", E.float v )) value.savedAt
            ]
        )


{-| bracket: Stats of the deck as submitted; the swaps are only suggestions.

targetBracket: Bracket the suggested swaps aim for.

cards: Every card in the deck as submitted, commanders included, for the card search.

-}
type alias DeckSummary =
    { slug : String
    , commanders : List String
    , format : String
    , createdAt : String
    , hasReport : Bool
    , image : Maybe String
    , colorIdentity : Maybe (List Color)
    , bracket : Maybe Float
    , landCount : Maybe Float
    , priceUsd : Maybe Float
    , swapCount : Maybe Float
    , targetBracket : Maybe Float
    , cards : List String
    }


deckSummaryDecoder : Decoder DeckSummary
deckSummaryDecoder =
    D.succeed DeckSummary
        |> P.required "slug" D.string
        |> P.required "commanders" (D.list D.string)
        |> P.required "format" D.string
        |> P.required "createdAt" D.string
        |> P.required "hasReport" D.bool
        |> P.required "image" (D.nullable D.string)
        |> P.optional "colorIdentity" (D.map Just (D.list colorDecoder)) Nothing
        |> P.optional "bracket" (D.map Just D.float) Nothing
        |> P.optional "landCount" (D.map Just D.float) Nothing
        |> P.optional "priceUsd" (D.map Just D.float) Nothing
        |> P.optional "swapCount" (D.map Just D.float) Nothing
        |> P.optional "targetBracket" (D.map Just D.float) Nothing
        |> P.required "cards" (D.list D.string)


encodeDeckSummary : DeckSummary -> E.Value
encodeDeckSummary value =
    E.object
        (List.filterMap identity
            [ Just ( "slug", E.string value.slug )
            , Just ( "commanders", E.list E.string value.commanders )
            , Just ( "format", E.string value.format )
            , Just ( "createdAt", E.string value.createdAt )
            , Just ( "hasReport", E.bool value.hasReport )
            , Just ( "image", Maybe.withDefault E.null (Maybe.map E.string value.image) )
            , Maybe.map (\v -> ( "colorIdentity", E.list encodeColor v )) value.colorIdentity
            , Maybe.map (\v -> ( "bracket", E.float v )) value.bracket
            , Maybe.map (\v -> ( "landCount", E.float v )) value.landCount
            , Maybe.map (\v -> ( "priceUsd", E.float v )) value.priceUsd
            , Maybe.map (\v -> ( "swapCount", E.float v )) value.swapCount
            , Maybe.map (\v -> ( "targetBracket", E.float v )) value.targetBracket
            , Just ( "cards", E.list E.string value.cards )
            ]
        )


type alias EditStatus =
    { id : String
    , slug : String
    , label : String
    , state : EditStatusState
    , error : Maybe String
    }


editStatusDecoder : Decoder EditStatus
editStatusDecoder =
    D.succeed EditStatus
        |> P.required "id" D.string
        |> P.required "slug" D.string
        |> P.required "label" D.string
        |> P.required "state" editStatusStateDecoder
        |> P.optional "error" (D.map Just D.string) Nothing


encodeEditStatus : EditStatus -> E.Value
encodeEditStatus value =
    E.object
        (List.filterMap identity
            [ Just ( "id", E.string value.id )
            , Just ( "slug", E.string value.slug )
            , Just ( "label", E.string value.label )
            , Just ( "state", encodeEditStatusState value.state )
            , Maybe.map (\v -> ( "error", E.string v )) value.error
            ]
        )


type EditStatusState
    = EditStatusStateQueued
    | EditStatusStateRunning
    | EditStatusStateDone
    | EditStatusStateFailed


editStatusStateToString : EditStatusState -> String
editStatusStateToString value =
    case value of
        EditStatusStateQueued ->
            "queued"

        EditStatusStateRunning ->
            "running"

        EditStatusStateDone ->
            "done"

        EditStatusStateFailed ->
            "failed"


editStatusStateFromString : String -> Maybe EditStatusState
editStatusStateFromString value =
    case value of
        "queued" ->
            Just EditStatusStateQueued

        "running" ->
            Just EditStatusStateRunning

        "done" ->
            Just EditStatusStateDone

        "failed" ->
            Just EditStatusStateFailed

        _ ->
            Nothing


editStatusStateDecoder : Decoder EditStatusState
editStatusStateDecoder =
    D.string
        |> D.andThen
            (\value ->
                case editStatusStateFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown EditStatusState: " ++ value)
            )


encodeEditStatusState : EditStatusState -> E.Value
encodeEditStatusState =
    editStatusStateToString >> E.string


type EditTarget
    = EditTargetOriginal
    | EditTargetOptimized


editTargetToString : EditTarget -> String
editTargetToString value =
    case value of
        EditTargetOriginal ->
            "original"

        EditTargetOptimized ->
            "optimized"


editTargetFromString : String -> Maybe EditTarget
editTargetFromString value =
    case value of
        "original" ->
            Just EditTargetOriginal

        "optimized" ->
            Just EditTargetOptimized

        _ ->
            Nothing


editTargetDecoder : Decoder EditTarget
editTargetDecoder =
    D.string
        |> D.andThen
            (\value ->
                case editTargetFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown EditTarget: " ++ value)
            )


encodeEditTarget : EditTarget -> E.Value
encodeEditTarget =
    editTargetToString >> E.string


{-| trace: What the run is doing, task by task and request by request.
-}
type alias Job =
    { id : String
    , slug : String
    , status : JobStatus
    , steps : List JobStep
    , error : Maybe String
    , trace : Maybe Trace
    }


jobDecoder : Decoder Job
jobDecoder =
    D.succeed Job
        |> P.required "id" D.string
        |> P.required "slug" D.string
        |> P.required "status" jobStatusDecoder
        |> P.required "steps" (D.list jobStepDecoder)
        |> P.optional "error" (D.map Just D.string) Nothing
        |> P.optional "trace" (D.map Just traceDecoder) Nothing


encodeJob : Job -> E.Value
encodeJob value =
    E.object
        (List.filterMap identity
            [ Just ( "id", E.string value.id )
            , Just ( "slug", E.string value.slug )
            , Just ( "status", encodeJobStatus value.status )
            , Just ( "steps", E.list encodeJobStep value.steps )
            , Maybe.map (\v -> ( "error", E.string v )) value.error
            , Maybe.map (\v -> ( "trace", encodeTrace v )) value.trace
            ]
        )


type JobStatus
    = JobStatusRunning
    | JobStatusDone
    | JobStatusError


jobStatusToString : JobStatus -> String
jobStatusToString value =
    case value of
        JobStatusRunning ->
            "running"

        JobStatusDone ->
            "done"

        JobStatusError ->
            "error"


jobStatusFromString : String -> Maybe JobStatus
jobStatusFromString value =
    case value of
        "running" ->
            Just JobStatusRunning

        "done" ->
            Just JobStatusDone

        "error" ->
            Just JobStatusError

        _ ->
            Nothing


jobStatusDecoder : Decoder JobStatus
jobStatusDecoder =
    D.string
        |> D.andThen
            (\value ->
                case jobStatusFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown JobStatus: " ++ value)
            )


encodeJobStatus : JobStatus -> E.Value
encodeJobStatus =
    jobStatusToString >> E.string


type alias JobStep =
    { label : String
    , status : JobStepStatus
    , detail : Maybe String
    }


jobStepDecoder : Decoder JobStep
jobStepDecoder =
    D.succeed JobStep
        |> P.required "label" D.string
        |> P.required "status" jobStepStatusDecoder
        |> P.optional "detail" (D.map Just D.string) Nothing


encodeJobStep : JobStep -> E.Value
encodeJobStep value =
    E.object
        (List.filterMap identity
            [ Just ( "label", E.string value.label )
            , Just ( "status", encodeJobStepStatus value.status )
            , Maybe.map (\v -> ( "detail", E.string v )) value.detail
            ]
        )


type JobStepStatus
    = JobStepStatusPending
    | JobStepStatusRunning
    | JobStepStatusDone
    | JobStepStatusError
    | JobStepStatusSkipped


jobStepStatusToString : JobStepStatus -> String
jobStepStatusToString value =
    case value of
        JobStepStatusPending ->
            "pending"

        JobStepStatusRunning ->
            "running"

        JobStepStatusDone ->
            "done"

        JobStepStatusError ->
            "error"

        JobStepStatusSkipped ->
            "skipped"


jobStepStatusFromString : String -> Maybe JobStepStatus
jobStepStatusFromString value =
    case value of
        "pending" ->
            Just JobStepStatusPending

        "running" ->
            Just JobStepStatusRunning

        "done" ->
            Just JobStepStatusDone

        "error" ->
            Just JobStepStatusError

        "skipped" ->
            Just JobStepStatusSkipped

        _ ->
            Nothing


jobStepStatusDecoder : Decoder JobStepStatus
jobStepStatusDecoder =
    D.string
        |> D.andThen
            (\value ->
                case jobStepStatusFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown JobStepStatus: " ++ value)
            )


encodeJobStepStatus : JobStepStatus -> E.Value
encodeJobStepStatus =
    jobStepStatusToString >> E.string


type alias ManaReport =
    { landCount : Float
    , mdfcLands : Float
    , recommendedLands : Float
    , avgCmc : Float
    , curve : Dict String Float
    , colors : List ColorStat
    , tappedLands : List String
    , colorlessLands : List String
    , basics : Dict String Float
    , rampCount : Float
    , issues : List String
    }


manaReportDecoder : Decoder ManaReport
manaReportDecoder =
    D.succeed ManaReport
        |> P.required "landCount" D.float
        |> P.required "mdfcLands" D.float
        |> P.required "recommendedLands" D.float
        |> P.required "avgCmc" D.float
        |> P.required "curve" (D.dict D.float)
        |> P.required "colors" (D.list colorStatDecoder)
        |> P.required "tappedLands" (D.list D.string)
        |> P.required "colorlessLands" (D.list D.string)
        |> P.required "basics" (D.dict D.float)
        |> P.required "rampCount" D.float
        |> P.required "issues" (D.list D.string)


encodeManaReport : ManaReport -> E.Value
encodeManaReport value =
    E.object
        (List.filterMap identity
            [ Just ( "landCount", E.float value.landCount )
            , Just ( "mdfcLands", E.float value.mdfcLands )
            , Just ( "recommendedLands", E.float value.recommendedLands )
            , Just ( "avgCmc", E.float value.avgCmc )
            , Just ( "curve", E.dict identity E.float value.curve )
            , Just ( "colors", E.list encodeColorStat value.colors )
            , Just ( "tappedLands", E.list E.string value.tappedLands )
            , Just ( "colorlessLands", E.list E.string value.colorlessLands )
            , Just ( "basics", E.dict identity E.float value.basics )
            , Just ( "rampCount", E.float value.rampCount )
            , Just ( "issues", E.list E.string value.issues )
            ]
        )


type alias ManaSuggestion =
    { id : String
    , reason : String
    , changes : List DeckChange
    }


manaSuggestionDecoder : Decoder ManaSuggestion
manaSuggestionDecoder =
    D.succeed ManaSuggestion
        |> P.required "id" D.string
        |> P.required "reason" D.string
        |> P.required "changes" (D.list deckChangeDecoder)


encodeManaSuggestion : ManaSuggestion -> E.Value
encodeManaSuggestion value =
    E.object
        (List.filterMap identity
            [ Just ( "id", E.string value.id )
            , Just ( "reason", E.string value.reason )
            , Just ( "changes", E.list encodeDeckChange value.changes )
            ]
        )


{-| budgetTotal: Max total price of the final deck (USD), including the commander.

bracket: Target bracket; null keeps the deck in the bracket it already fits.

tone: How hard to push within the bracket.

excluded: Cards never to add: ones the user removed in chat, kept out by a re-run that keeps edits.

-}
type alias OptimizeOptions =
    { maxSwaps : Float
    , budgetPerCard : Maybe Float
    , budgetTotal : Maybe Float
    , bracket : Maybe Float
    , tone : Tone
    , locked : List String
    , excluded : Maybe (List String)
    , webResearch : Bool
    }


optimizeOptionsDecoder : Decoder OptimizeOptions
optimizeOptionsDecoder =
    D.succeed OptimizeOptions
        |> P.required "maxSwaps" D.float
        |> P.required "budgetPerCard" (D.nullable D.float)
        |> P.required "budgetTotal" (D.nullable D.float)
        |> P.required "bracket" (D.nullable D.float)
        |> P.required "tone" toneDecoder
        |> P.required "locked" (D.list D.string)
        |> P.optional "excluded" (D.map Just (D.list D.string)) Nothing
        |> P.required "webResearch" D.bool


encodeOptimizeOptions : OptimizeOptions -> E.Value
encodeOptimizeOptions value =
    E.object
        (List.filterMap identity
            [ Just ( "maxSwaps", E.float value.maxSwaps )
            , Just ( "budgetPerCard", Maybe.withDefault E.null (Maybe.map E.float value.budgetPerCard) )
            , Just ( "budgetTotal", Maybe.withDefault E.null (Maybe.map E.float value.budgetTotal) )
            , Just ( "bracket", Maybe.withDefault E.null (Maybe.map E.float value.bracket) )
            , Just ( "tone", encodeTone value.tone )
            , Just ( "locked", E.list E.string value.locked )
            , Maybe.map (\v -> ( "excluded", E.list E.string v )) value.excluded
            , Just ( "webResearch", E.bool value.webResearch )
            ]
        )


{-| summary: What the deck does, in a sentence or two.

early: Short bullets for each stage of a game.

keyCards: Cards in this deck that matter most, and why.

mulligan: What a keepable opening hand looks like.

-}
type alias PlayGuide =
    { summary : String
    , early : List String
    , mid : List String
    , late : List String
    , winConditions : List String
    , keyCards : List PlayGuideKeyCard
    , mulligan : String
    , watchOut : List String
    }


playGuideDecoder : Decoder PlayGuide
playGuideDecoder =
    D.succeed PlayGuide
        |> P.required "summary" D.string
        |> P.required "early" (D.list D.string)
        |> P.required "mid" (D.list D.string)
        |> P.required "late" (D.list D.string)
        |> P.required "winConditions" (D.list D.string)
        |> P.required "keyCards" (D.list playGuideKeyCardDecoder)
        |> P.required "mulligan" D.string
        |> P.required "watchOut" (D.list D.string)


encodePlayGuide : PlayGuide -> E.Value
encodePlayGuide value =
    E.object
        (List.filterMap identity
            [ Just ( "summary", E.string value.summary )
            , Just ( "early", E.list E.string value.early )
            , Just ( "mid", E.list E.string value.mid )
            , Just ( "late", E.list E.string value.late )
            , Just ( "winConditions", E.list E.string value.winConditions )
            , Just ( "keyCards", E.list encodePlayGuideKeyCard value.keyCards )
            , Just ( "mulligan", E.string value.mulligan )
            , Just ( "watchOut", E.list E.string value.watchOut )
            ]
        )


type alias PlayGuideKeyCard =
    { name : String
    , why : String
    }


playGuideKeyCardDecoder : Decoder PlayGuideKeyCard
playGuideKeyCardDecoder =
    D.succeed PlayGuideKeyCard
        |> P.required "name" D.string
        |> P.required "why" D.string


encodePlayGuideKeyCard : PlayGuideKeyCard -> E.Value
encodePlayGuideKeyCard value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Just ( "why", E.string value.why )
            ]
        )


type alias Recognition =
    { format : RecognitionResultFormat
    , formatConfidence : Float
    , commanders : List String
    , commanderCards : List Card
    , commanderCandidates : List String
    , deckName : Maybe String
    , entries : List RecognizedEntry
    , notes : List String
    , uploadToken : Maybe String
    }


recognitionDecoder : Decoder Recognition
recognitionDecoder =
    D.succeed Recognition
        |> P.required "format" recognitionResultFormatDecoder
        |> P.required "formatConfidence" D.float
        |> P.required "commanders" (D.list D.string)
        |> P.required "commanderCards" (D.list cardDecoder)
        |> P.required "commanderCandidates" (D.list D.string)
        |> P.required "deckName" (D.nullable D.string)
        |> P.required "entries" (D.list recognizedEntryDecoder)
        |> P.required "notes" (D.list D.string)
        |> P.optional "uploadToken" (D.map Just D.string) Nothing


encodeRecognition : Recognition -> E.Value
encodeRecognition value =
    E.object
        (List.filterMap identity
            [ Just ( "format", encodeRecognitionResultFormat value.format )
            , Just ( "formatConfidence", E.float value.formatConfidence )
            , Just ( "commanders", E.list E.string value.commanders )
            , Just ( "commanderCards", E.list encodeCard value.commanderCards )
            , Just ( "commanderCandidates", E.list E.string value.commanderCandidates )
            , Just ( "deckName", Maybe.withDefault E.null (Maybe.map E.string value.deckName) )
            , Just ( "entries", E.list encodeRecognizedEntry value.entries )
            , Just ( "notes", E.list E.string value.notes )
            , Maybe.map (\v -> ( "uploadToken", E.string v )) value.uploadToken
            ]
        )


type alias RecognitionJob =
    { id : String
    , status : RecognitionJobStatus
    , phase : String
    , done : Float
    , total : Float
    , result : Maybe Recognition
    , error : Maybe String
    }


recognitionJobDecoder : Decoder RecognitionJob
recognitionJobDecoder =
    D.succeed RecognitionJob
        |> P.required "id" D.string
        |> P.required "status" recognitionJobStatusDecoder
        |> P.required "phase" D.string
        |> P.required "done" D.float
        |> P.required "total" D.float
        |> P.optional "result" (D.map Just recognitionDecoder) Nothing
        |> P.optional "error" (D.map Just D.string) Nothing


encodeRecognitionJob : RecognitionJob -> E.Value
encodeRecognitionJob value =
    E.object
        (List.filterMap identity
            [ Just ( "id", E.string value.id )
            , Just ( "status", encodeRecognitionJobStatus value.status )
            , Just ( "phase", E.string value.phase )
            , Just ( "done", E.float value.done )
            , Just ( "total", E.float value.total )
            , Maybe.map (\v -> ( "result", encodeRecognition v )) value.result
            , Maybe.map (\v -> ( "error", E.string v )) value.error
            ]
        )


type RecognitionJobStatus
    = RecognitionJobStatusRunning
    | RecognitionJobStatusDone
    | RecognitionJobStatusError


recognitionJobStatusToString : RecognitionJobStatus -> String
recognitionJobStatusToString value =
    case value of
        RecognitionJobStatusRunning ->
            "running"

        RecognitionJobStatusDone ->
            "done"

        RecognitionJobStatusError ->
            "error"


recognitionJobStatusFromString : String -> Maybe RecognitionJobStatus
recognitionJobStatusFromString value =
    case value of
        "running" ->
            Just RecognitionJobStatusRunning

        "done" ->
            Just RecognitionJobStatusDone

        "error" ->
            Just RecognitionJobStatusError

        _ ->
            Nothing


recognitionJobStatusDecoder : Decoder RecognitionJobStatus
recognitionJobStatusDecoder =
    D.string
        |> D.andThen
            (\value ->
                case recognitionJobStatusFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown RecognitionJobStatus: " ++ value)
            )


encodeRecognitionJobStatus : RecognitionJobStatus -> E.Value
encodeRecognitionJobStatus =
    recognitionJobStatusToString >> E.string


type alias RecognitionResult =
    { format : RecognitionResultFormat
    , formatConfidence : Float
    , commanders : List String
    , commanderCards : List Card
    , commanderCandidates : List String
    , deckName : Maybe String
    , entries : List RecognizedEntry
    , notes : List String
    }


recognitionResultDecoder : Decoder RecognitionResult
recognitionResultDecoder =
    D.succeed RecognitionResult
        |> P.required "format" recognitionResultFormatDecoder
        |> P.required "formatConfidence" D.float
        |> P.required "commanders" (D.list D.string)
        |> P.required "commanderCards" (D.list cardDecoder)
        |> P.required "commanderCandidates" (D.list D.string)
        |> P.required "deckName" (D.nullable D.string)
        |> P.required "entries" (D.list recognizedEntryDecoder)
        |> P.required "notes" (D.list D.string)


encodeRecognitionResult : RecognitionResult -> E.Value
encodeRecognitionResult value =
    E.object
        (List.filterMap identity
            [ Just ( "format", encodeRecognitionResultFormat value.format )
            , Just ( "formatConfidence", E.float value.formatConfidence )
            , Just ( "commanders", E.list E.string value.commanders )
            , Just ( "commanderCards", E.list encodeCard value.commanderCards )
            , Just ( "commanderCandidates", E.list E.string value.commanderCandidates )
            , Just ( "deckName", Maybe.withDefault E.null (Maybe.map E.string value.deckName) )
            , Just ( "entries", E.list encodeRecognizedEntry value.entries )
            , Just ( "notes", E.list E.string value.notes )
            ]
        )


type RecognitionResultFormat
    = RecognitionResultFormatCommander
    | RecognitionResultFormatOther


recognitionResultFormatToString : RecognitionResultFormat -> String
recognitionResultFormatToString value =
    case value of
        RecognitionResultFormatCommander ->
            "commander"

        RecognitionResultFormatOther ->
            "other"


recognitionResultFormatFromString : String -> Maybe RecognitionResultFormat
recognitionResultFormatFromString value =
    case value of
        "commander" ->
            Just RecognitionResultFormatCommander

        "other" ->
            Just RecognitionResultFormatOther

        _ ->
            Nothing


recognitionResultFormatDecoder : Decoder RecognitionResultFormat
recognitionResultFormatDecoder =
    D.string
        |> D.andThen
            (\value ->
                case recognitionResultFormatFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown RecognitionResultFormat: " ++ value)
            )


encodeRecognitionResultFormat : RecognitionResultFormat -> E.Value
encodeRecognitionResultFormat =
    recognitionResultFormatToString >> E.string


{-| raw: Raw text read from the image, before name resolution.

lang: Language the card is printed in (Scryfall code), from photo recognition.

votes: Independent reading passes that saw this card.

confidence: 0-1: 1 when several passes agree, otherwise the verification probability.

-}
type alias RecognizedEntry =
    { qty : Float
    , name : String
    , raw : String
    , status : RecognizedEntryStatus
    , card : Maybe Card
    , lang : Maybe String
    , votes : Maybe Float
    , confidence : Maybe Float
    }


recognizedEntryDecoder : Decoder RecognizedEntry
recognizedEntryDecoder =
    D.succeed RecognizedEntry
        |> P.required "qty" D.float
        |> P.required "name" D.string
        |> P.required "raw" D.string
        |> P.required "status" recognizedEntryStatusDecoder
        |> P.optional "card" (D.map Just cardDecoder) Nothing
        |> P.optional "lang" (D.map Just D.string) Nothing
        |> P.optional "votes" (D.map Just D.float) Nothing
        |> P.optional "confidence" (D.map Just D.float) Nothing


encodeRecognizedEntry : RecognizedEntry -> E.Value
encodeRecognizedEntry value =
    E.object
        (List.filterMap identity
            [ Just ( "qty", E.float value.qty )
            , Just ( "name", E.string value.name )
            , Just ( "raw", E.string value.raw )
            , Just ( "status", encodeRecognizedEntryStatus value.status )
            , Maybe.map (\v -> ( "card", encodeCard v )) value.card
            , Maybe.map (\v -> ( "lang", E.string v )) value.lang
            , Maybe.map (\v -> ( "votes", E.float v )) value.votes
            , Maybe.map (\v -> ( "confidence", E.float v )) value.confidence
            ]
        )


type RecognizedEntryStatus
    = RecognizedEntryStatusExact
    | RecognizedEntryStatusFuzzy
    | RecognizedEntryStatusUnresolved


recognizedEntryStatusToString : RecognizedEntryStatus -> String
recognizedEntryStatusToString value =
    case value of
        RecognizedEntryStatusExact ->
            "exact"

        RecognizedEntryStatusFuzzy ->
            "fuzzy"

        RecognizedEntryStatusUnresolved ->
            "unresolved"


recognizedEntryStatusFromString : String -> Maybe RecognizedEntryStatus
recognizedEntryStatusFromString value =
    case value of
        "exact" ->
            Just RecognizedEntryStatusExact

        "fuzzy" ->
            Just RecognizedEntryStatusFuzzy

        "unresolved" ->
            Just RecognizedEntryStatusUnresolved

        _ ->
            Nothing


recognizedEntryStatusDecoder : Decoder RecognizedEntryStatus
recognizedEntryStatusDecoder =
    D.string
        |> D.andThen
            (\value ->
                case recognizedEntryStatusFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown RecognizedEntryStatus: " ++ value)
            )


encodeRecognizedEntryStatus : RecognizedEntryStatus -> E.Value
encodeRecognizedEntryStatus =
    recognizedEntryStatusToString >> E.string


{-| edits: Changes applied through chat after optimization, oldest first.

original: The deck as submitted, for the default view; `before` and `bracket.before` hold its stats.

howToPlay: How to play the deck as submitted and the suggested one (needs an LLM).

synergies: Strong non-combo interactions in the deck (needs an LLM).

manaSuggestions: Land swaps that would still improve the mana base; recomputed after every edit.

cardIndex: Preview data for every card the report mentions, so any card name can show its image.

decklist: Optimized list with display data; absent in reports generated before it existed.

suggestionsHidden: Published without the doc's suggestions: only the deck as submitted (see `withoutSuggestions`).

-}
type alias Report =
    { slug : String
    , commanders : List String
    , commanderCards : List Card
    , generatedAt : String
    , model : Maybe String
    , strategy : String
    , themes : List String
    , swaps : List Swap
    , before : DeckSnapshot
    , after : DeckSnapshot
    , combosPresent : List Combo
    , combosOneAway : List Combo
    , research : Maybe Research
    , edhrec : Maybe ReportEdhrec
    , warnings : List String
    , options : OptimizeOptions
    , bracket : Maybe BracketReport
    , edits : Maybe (List DeckEdit)
    , original : Maybe ReportOriginal
    , howToPlay : Maybe ReportHowToPlay
    , synergies : Maybe (List Synergy)
    , manaSuggestions : Maybe (List ManaSuggestion)
    , cardIndex : Maybe (Dict String CardPreview)
    , decklist : Maybe (List DecklistCard)
    , suggestionsHidden : Maybe Bool
    }


reportDecoder : Decoder Report
reportDecoder =
    D.succeed Report
        |> P.required "slug" D.string
        |> P.required "commanders" (D.list D.string)
        |> P.required "commanderCards" (D.list cardDecoder)
        |> P.required "generatedAt" D.string
        |> P.required "model" (D.nullable D.string)
        |> P.required "strategy" D.string
        |> P.required "themes" (D.list D.string)
        |> P.required "swaps" (D.list swapDecoder)
        |> P.required "before" deckSnapshotDecoder
        |> P.required "after" deckSnapshotDecoder
        |> P.required "combosPresent" (D.list comboDecoder)
        |> P.required "combosOneAway" (D.list comboDecoder)
        |> P.required "research" (D.nullable researchDecoder)
        |> P.required "edhrec" (D.nullable reportEdhrecDecoder)
        |> P.required "warnings" (D.list D.string)
        |> P.required "options" optimizeOptionsDecoder
        |> P.optional "bracket" (D.map Just bracketReportDecoder) Nothing
        |> P.optional "edits" (D.map Just (D.list deckEditDecoder)) Nothing
        |> P.optional "original" (D.map Just reportOriginalDecoder) Nothing
        |> P.optional "howToPlay" (D.map Just reportHowToPlayDecoder) Nothing
        |> P.optional "synergies" (D.map Just (D.list synergyDecoder)) Nothing
        |> P.optional "manaSuggestions" (D.map Just (D.list manaSuggestionDecoder)) Nothing
        |> P.optional "cardIndex" (D.map Just (D.dict cardPreviewDecoder)) Nothing
        |> P.optional "decklist" (D.map Just (D.list decklistCardDecoder)) Nothing
        |> P.optional "suggestionsHidden" (D.map Just D.bool) Nothing


encodeReport : Report -> E.Value
encodeReport value =
    E.object
        (List.filterMap identity
            [ Just ( "slug", E.string value.slug )
            , Just ( "commanders", E.list E.string value.commanders )
            , Just ( "commanderCards", E.list encodeCard value.commanderCards )
            , Just ( "generatedAt", E.string value.generatedAt )
            , Just ( "model", Maybe.withDefault E.null (Maybe.map E.string value.model) )
            , Just ( "strategy", E.string value.strategy )
            , Just ( "themes", E.list E.string value.themes )
            , Just ( "swaps", E.list encodeSwap value.swaps )
            , Just ( "before", encodeDeckSnapshot value.before )
            , Just ( "after", encodeDeckSnapshot value.after )
            , Just ( "combosPresent", E.list encodeCombo value.combosPresent )
            , Just ( "combosOneAway", E.list encodeCombo value.combosOneAway )
            , Just ( "research", Maybe.withDefault E.null (Maybe.map encodeResearch value.research) )
            , Just ( "edhrec", Maybe.withDefault E.null (Maybe.map encodeReportEdhrec value.edhrec) )
            , Just ( "warnings", E.list E.string value.warnings )
            , Just ( "options", encodeOptimizeOptions value.options )
            , Maybe.map (\v -> ( "bracket", encodeBracketReport v )) value.bracket
            , Maybe.map (\v -> ( "edits", E.list encodeDeckEdit v )) value.edits
            , Maybe.map (\v -> ( "original", encodeReportOriginal v )) value.original
            , Maybe.map (\v -> ( "howToPlay", encodeReportHowToPlay v )) value.howToPlay
            , Maybe.map (\v -> ( "synergies", E.list encodeSynergy v )) value.synergies
            , Maybe.map (\v -> ( "manaSuggestions", E.list encodeManaSuggestion v )) value.manaSuggestions
            , Maybe.map (\v -> ( "cardIndex", E.dict identity encodeCardPreview v )) value.cardIndex
            , Maybe.map (\v -> ( "decklist", E.list encodeDecklistCard v )) value.decklist
            , Maybe.map (\v -> ( "suggestionsHidden", E.bool v )) value.suggestionsHidden
            ]
        )


type alias ReportEdhrec =
    { url : String
    , numDecks : Maybe Float
    , avgLands : Maybe Float
    }


reportEdhrecDecoder : Decoder ReportEdhrec
reportEdhrecDecoder =
    D.succeed ReportEdhrec
        |> P.required "url" D.string
        |> P.required "numDecks" (D.nullable D.float)
        |> P.required "avgLands" (D.nullable D.float)


encodeReportEdhrec : ReportEdhrec -> E.Value
encodeReportEdhrec value =
    E.object
        (List.filterMap identity
            [ Just ( "url", E.string value.url )
            , Just ( "numDecks", Maybe.withDefault E.null (Maybe.map E.float value.numDecks) )
            , Just ( "avgLands", Maybe.withDefault E.null (Maybe.map E.float value.avgLands) )
            ]
        )


type alias ReportHowToPlay =
    { original : Maybe PlayGuide
    , optimized : Maybe PlayGuide
    }


reportHowToPlayDecoder : Decoder ReportHowToPlay
reportHowToPlayDecoder =
    D.succeed ReportHowToPlay
        |> P.optional "original" (D.map Just playGuideDecoder) Nothing
        |> P.optional "optimized" (D.map Just playGuideDecoder) Nothing


encodeReportHowToPlay : ReportHowToPlay -> E.Value
encodeReportHowToPlay value =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "original", encodePlayGuide v )) value.original
            , Maybe.map (\v -> ( "optimized", encodePlayGuide v )) value.optimized
            ]
        )


type alias ReportOriginal =
    { decklist : List DecklistCard
    , combosPresent : List Combo
    , combosOneAway : List Combo
    }


reportOriginalDecoder : Decoder ReportOriginal
reportOriginalDecoder =
    D.succeed ReportOriginal
        |> P.required "decklist" (D.list decklistCardDecoder)
        |> P.required "combosPresent" (D.list comboDecoder)
        |> P.required "combosOneAway" (D.list comboDecoder)


encodeReportOriginal : ReportOriginal -> E.Value
encodeReportOriginal value =
    E.object
        (List.filterMap identity
            [ Just ( "decklist", E.list encodeDecklistCard value.decklist )
            , Just ( "combosPresent", E.list encodeCombo value.combosPresent )
            , Just ( "combosOneAway", E.list encodeCombo value.combosOneAway )
            ]
        )


{-| budgetTotal: Max total price of the final deck (USD), including the commander.

bracket: Target bracket; null keeps the deck in the bracket it already fits.

tone: How hard to push within the bracket.

-}
type alias RerunOptions =
    { maxSwaps : Maybe Float
    , budgetPerCard : Maybe Float
    , budgetTotal : Maybe Float
    , bracket : Maybe Float
    , tone : Maybe Tone
    , webResearch : Maybe Bool
    }


rerunOptionsDecoder : Decoder RerunOptions
rerunOptionsDecoder =
    D.succeed RerunOptions
        |> P.optional "maxSwaps" (D.map Just D.float) Nothing
        |> P.optional "budgetPerCard" (D.map Just D.float) Nothing
        |> P.optional "budgetTotal" (D.map Just D.float) Nothing
        |> P.optional "bracket" (D.map Just D.float) Nothing
        |> P.optional "tone" (D.map Just toneDecoder) Nothing
        |> P.optional "webResearch" (D.map Just D.bool) Nothing


encodeRerunOptions : RerunOptions -> E.Value
encodeRerunOptions value =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "maxSwaps", E.float v )) value.maxSwaps
            , Maybe.map (\v -> ( "budgetPerCard", E.float v )) value.budgetPerCard
            , Maybe.map (\v -> ( "budgetTotal", E.float v )) value.budgetTotal
            , Maybe.map (\v -> ( "bracket", E.float v )) value.bracket
            , Maybe.map (\v -> ( "tone", encodeTone v )) value.tone
            , Maybe.map (\v -> ( "webResearch", E.bool v )) value.webResearch
            ]
        )


{-| keepEdits: Start from the current suggestions with the user's chat edits kept, rather than afresh.

jobId: Set once the user confirmed and the job started.

-}
type alias RerunProposal =
    { options : RerunOptions
    , summary : String
    , keepEdits : Maybe Bool
    , jobId : Maybe String
    }


rerunProposalDecoder : Decoder RerunProposal
rerunProposalDecoder =
    D.succeed RerunProposal
        |> P.required "options" rerunOptionsDecoder
        |> P.required "summary" D.string
        |> P.optional "keepEdits" (D.map Just D.bool) Nothing
        |> P.optional "jobId" (D.map Just D.string) Nothing


encodeRerunProposal : RerunProposal -> E.Value
encodeRerunProposal value =
    E.object
        (List.filterMap identity
            [ Just ( "options", encodeRerunOptions value.options )
            , Just ( "summary", E.string value.summary )
            , Maybe.map (\v -> ( "keepEdits", E.bool v )) value.keepEdits
            , Maybe.map (\v -> ( "jobId", E.string v )) value.jobId
            ]
        )


type alias Research =
    { summary : String
    , cardsMentioned : List String
    , sources : List ResearchSource
    }


researchDecoder : Decoder Research
researchDecoder =
    D.succeed Research
        |> P.required "summary" D.string
        |> P.required "cardsMentioned" (D.list D.string)
        |> P.required "sources" (D.list researchSourceDecoder)


encodeResearch : Research -> E.Value
encodeResearch value =
    E.object
        (List.filterMap identity
            [ Just ( "summary", E.string value.summary )
            , Just ( "cardsMentioned", E.list E.string value.cardsMentioned )
            , Just ( "sources", E.list encodeResearchSource value.sources )
            ]
        )


type alias ResearchSource =
    { title : String
    , url : String
    }


researchSourceDecoder : Decoder ResearchSource
researchSourceDecoder =
    D.succeed ResearchSource
        |> P.required "title" D.string
        |> P.required "url" D.string


encodeResearchSource : ResearchSource -> E.Value
encodeResearchSource value =
    E.object
        (List.filterMap identity
            [ Just ( "title", E.string value.title )
            , Just ( "url", E.string value.url )
            ]
        )


type alias ResolvedName =
    { requested : String
    , card : Maybe Card
    , status : ResolvedNameStatus
    }


resolvedNameDecoder : Decoder ResolvedName
resolvedNameDecoder =
    D.succeed ResolvedName
        |> P.required "requested" D.string
        |> P.required "card" (D.nullable cardDecoder)
        |> P.required "status" resolvedNameStatusDecoder


encodeResolvedName : ResolvedName -> E.Value
encodeResolvedName value =
    E.object
        (List.filterMap identity
            [ Just ( "requested", E.string value.requested )
            , Just ( "card", Maybe.withDefault E.null (Maybe.map encodeCard value.card) )
            , Just ( "status", encodeResolvedNameStatus value.status )
            ]
        )


type ResolvedNameStatus
    = ResolvedNameStatusExact
    | ResolvedNameStatusFuzzy
    | ResolvedNameStatusUnresolved


resolvedNameStatusToString : ResolvedNameStatus -> String
resolvedNameStatusToString value =
    case value of
        ResolvedNameStatusExact ->
            "exact"

        ResolvedNameStatusFuzzy ->
            "fuzzy"

        ResolvedNameStatusUnresolved ->
            "unresolved"


resolvedNameStatusFromString : String -> Maybe ResolvedNameStatus
resolvedNameStatusFromString value =
    case value of
        "exact" ->
            Just ResolvedNameStatusExact

        "fuzzy" ->
            Just ResolvedNameStatusFuzzy

        "unresolved" ->
            Just ResolvedNameStatusUnresolved

        _ ->
            Nothing


resolvedNameStatusDecoder : Decoder ResolvedNameStatus
resolvedNameStatusDecoder =
    D.string
        |> D.andThen
            (\value ->
                case resolvedNameStatusFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown ResolvedNameStatus: " ++ value)
            )


encodeResolvedNameStatus : ResolvedNameStatus -> E.Value
encodeResolvedNameStatus =
    resolvedNameStatusToString >> E.string


type Role
    = RoleLand
    | RoleRamp
    | RoleDraw
    | RoleRemoval
    | RoleWipe
    | RoleCounter
    | RoleTutor
    | RoleProtection
    | RoleRecursion
    | RoleWincon
    | RoleOther


roleToString : Role -> String
roleToString value =
    case value of
        RoleLand ->
            "land"

        RoleRamp ->
            "ramp"

        RoleDraw ->
            "draw"

        RoleRemoval ->
            "removal"

        RoleWipe ->
            "wipe"

        RoleCounter ->
            "counter"

        RoleTutor ->
            "tutor"

        RoleProtection ->
            "protection"

        RoleRecursion ->
            "recursion"

        RoleWincon ->
            "wincon"

        RoleOther ->
            "other"


roleFromString : String -> Maybe Role
roleFromString value =
    case value of
        "land" ->
            Just RoleLand

        "ramp" ->
            Just RoleRamp

        "draw" ->
            Just RoleDraw

        "removal" ->
            Just RoleRemoval

        "wipe" ->
            Just RoleWipe

        "counter" ->
            Just RoleCounter

        "tutor" ->
            Just RoleTutor

        "protection" ->
            Just RoleProtection

        "recursion" ->
            Just RoleRecursion

        "wincon" ->
            Just RoleWincon

        "other" ->
            Just RoleOther

        _ ->
            Nothing


roleDecoder : Decoder Role
roleDecoder =
    D.string
        |> D.andThen
            (\value ->
                case roleFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown Role: " ++ value)
            )


encodeRole : Role -> E.Value
encodeRole =
    roleToString >> E.string


type alias RoleCount =
    { role : Role
    , count : Float
    , target : Maybe Float
    }


roleCountDecoder : Decoder RoleCount
roleCountDecoder =
    D.succeed RoleCount
        |> P.required "role" roleDecoder
        |> P.required "count" D.float
        |> P.required "target" (D.nullable D.float)


encodeRoleCount : RoleCount -> E.Value
encodeRoleCount value =
    E.object
        (List.filterMap identity
            [ Just ( "role", encodeRole value.role )
            , Just ( "count", E.float value.count )
            , Just ( "target", Maybe.withDefault E.null (Maybe.map E.float value.target) )
            ]
        )


type alias SaveDeckRequest =
    { format : SaveDeckRequestFormat
    , commanders : List String
    , deckName : Maybe String
    , entries : List DeckEntry
    , options : OptimizeOptions
    }


saveDeckRequestDecoder : Decoder SaveDeckRequest
saveDeckRequestDecoder =
    D.succeed SaveDeckRequest
        |> P.required "format" saveDeckRequestFormatDecoder
        |> P.required "commanders" (D.list D.string)
        |> P.required "deckName" (D.nullable D.string)
        |> P.required "entries" (D.list deckEntryDecoder)
        |> P.required "options" optimizeOptionsDecoder


encodeSaveDeckRequest : SaveDeckRequest -> E.Value
encodeSaveDeckRequest value =
    E.object
        (List.filterMap identity
            [ Just ( "format", encodeSaveDeckRequestFormat value.format )
            , Just ( "commanders", E.list E.string value.commanders )
            , Just ( "deckName", Maybe.withDefault E.null (Maybe.map E.string value.deckName) )
            , Just ( "entries", E.list encodeDeckEntry value.entries )
            , Just ( "options", encodeOptimizeOptions value.options )
            ]
        )


type SaveDeckRequestFormat
    = SaveDeckRequestFormatCommander
    | SaveDeckRequestFormatOther


saveDeckRequestFormatToString : SaveDeckRequestFormat -> String
saveDeckRequestFormatToString value =
    case value of
        SaveDeckRequestFormatCommander ->
            "commander"

        SaveDeckRequestFormatOther ->
            "other"


saveDeckRequestFormatFromString : String -> Maybe SaveDeckRequestFormat
saveDeckRequestFormatFromString value =
    case value of
        "commander" ->
            Just SaveDeckRequestFormatCommander

        "other" ->
            Just SaveDeckRequestFormatOther

        _ ->
            Nothing


saveDeckRequestFormatDecoder : Decoder SaveDeckRequestFormat
saveDeckRequestFormatDecoder =
    D.string
        |> D.andThen
            (\value ->
                case saveDeckRequestFormatFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown SaveDeckRequestFormat: " ++ value)
            )


encodeSaveDeckRequestFormat : SaveDeckRequestFormat -> E.Value
encodeSaveDeckRequestFormat =
    saveDeckRequestFormatToString >> E.string


type Service
    = ServiceScryfall
    | ServiceSpellbook
    | ServiceEdhrec
    | ServiceModel
    | ServiceDecisions


serviceToString : Service -> String
serviceToString value =
    case value of
        ServiceScryfall ->
            "scryfall"

        ServiceSpellbook ->
            "spellbook"

        ServiceEdhrec ->
            "edhrec"

        ServiceModel ->
            "model"

        ServiceDecisions ->
            "decisions"


serviceFromString : String -> Maybe Service
serviceFromString value =
    case value of
        "scryfall" ->
            Just ServiceScryfall

        "spellbook" ->
            Just ServiceSpellbook

        "edhrec" ->
            Just ServiceEdhrec

        "model" ->
            Just ServiceModel

        "decisions" ->
            Just ServiceDecisions

        _ ->
            Nothing


serviceDecoder : Decoder Service
serviceDecoder =
    D.string
        |> D.andThen
            (\value ->
                case serviceFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown Service: " ++ value)
            )


encodeService : Service -> E.Value
encodeService =
    serviceToString >> E.string


{-| combos: Cumulative % of games where each combo is assembled and castable by a given turn.
-}
type alias SimResult =
    { games : Float
    , mulliganRate : Float
    , landDropByTurn : Dict String Float
    , commanderOnCurve : Float
    , commanderByTurn : Dict String Float
    , allColorsByTurn3 : Float
    , avgManaTurn4 : Float
    , screwRate : Float
    , floodRate : Float
    , combos : Maybe (List SimResultCombo)
    }


simResultDecoder : Decoder SimResult
simResultDecoder =
    D.succeed SimResult
        |> P.required "games" D.float
        |> P.required "mulliganRate" D.float
        |> P.required "landDropByTurn" (D.dict D.float)
        |> P.required "commanderOnCurve" D.float
        |> P.required "commanderByTurn" (D.dict D.float)
        |> P.required "allColorsByTurn3" D.float
        |> P.required "avgManaTurn4" D.float
        |> P.required "screwRate" D.float
        |> P.required "floodRate" D.float
        |> P.optional "combos" (D.map Just (D.list simResultComboDecoder)) Nothing


encodeSimResult : SimResult -> E.Value
encodeSimResult value =
    E.object
        (List.filterMap identity
            [ Just ( "games", E.float value.games )
            , Just ( "mulliganRate", E.float value.mulliganRate )
            , Just ( "landDropByTurn", E.dict identity E.float value.landDropByTurn )
            , Just ( "commanderOnCurve", E.float value.commanderOnCurve )
            , Just ( "commanderByTurn", E.dict identity E.float value.commanderByTurn )
            , Just ( "allColorsByTurn3", E.float value.allColorsByTurn3 )
            , Just ( "avgManaTurn4", E.float value.avgManaTurn4 )
            , Just ( "screwRate", E.float value.screwRate )
            , Just ( "floodRate", E.float value.floodRate )
            , Maybe.map (\v -> ( "combos", E.list encodeSimResultCombo v )) value.combos
            ]
        )


type alias SimResultCombo =
    { cards : List String
    , byTurn : Dict String Float
    }


simResultComboDecoder : Decoder SimResultCombo
simResultComboDecoder =
    D.succeed SimResultCombo
        |> P.required "cards" (D.list D.string)
        |> P.required "byTurn" (D.dict D.float)


encodeSimResultCombo : SimResultCombo -> E.Value
encodeSimResultCombo value =
    E.object
        (List.filterMap identity
            [ Just ( "cards", E.list E.string value.cards )
            , Just ( "byTurn", E.dict identity E.float value.byTurn )
            ]
        )


{-| alternatives: Other strong options for the same slot.

fromChat: Paired up after chat edits changed the list, rather than proposed by the optimizer.

-}
type alias Swap =
    { out : String
    , in_ : String
    , category : SwapCategory
    , reason : String
    , alternatives : Maybe (List SwapAlternative)
    , outCard : Maybe Card
    , inCard : Maybe Card
    , fromChat : Maybe Bool
    }


swapDecoder : Decoder Swap
swapDecoder =
    D.succeed Swap
        |> P.required "out" D.string
        |> P.required "in" D.string
        |> P.required "category" swapCategoryDecoder
        |> P.required "reason" D.string
        |> P.optional "alternatives" (D.map Just (D.list swapAlternativeDecoder)) Nothing
        |> P.optional "outCard" (D.map Just cardDecoder) Nothing
        |> P.optional "inCard" (D.map Just cardDecoder) Nothing
        |> P.optional "fromChat" (D.map Just D.bool) Nothing


encodeSwap : Swap -> E.Value
encodeSwap value =
    E.object
        (List.filterMap identity
            [ Just ( "out", E.string value.out )
            , Just ( "in", E.string value.in_ )
            , Just ( "category", encodeSwapCategory value.category )
            , Just ( "reason", E.string value.reason )
            , Maybe.map (\v -> ( "alternatives", E.list encodeSwapAlternative v )) value.alternatives
            , Maybe.map (\v -> ( "outCard", encodeCard v )) value.outCard
            , Maybe.map (\v -> ( "inCard", encodeCard v )) value.inCard
            , Maybe.map (\v -> ( "fromChat", E.bool v )) value.fromChat
            ]
        )


type alias SwapAlternative =
    { name : String
    , image : Maybe String
    , scryfallUri : String
    }


swapAlternativeDecoder : Decoder SwapAlternative
swapAlternativeDecoder =
    D.succeed SwapAlternative
        |> P.required "name" D.string
        |> P.required "image" (D.nullable D.string)
        |> P.required "scryfallUri" D.string


encodeSwapAlternative : SwapAlternative -> E.Value
encodeSwapAlternative value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Just ( "image", Maybe.withDefault E.null (Maybe.map E.string value.image) )
            , Just ( "scryfallUri", E.string value.scryfallUri )
            ]
        )


type SwapCategory
    = SwapCategoryBracket
    | SwapCategorySynergy
    | SwapCategoryCombo
    | SwapCategoryMana
    | SwapCategoryRamp
    | SwapCategoryDraw
    | SwapCategoryInteraction
    | SwapCategoryCurve
    | SwapCategoryOther


swapCategoryToString : SwapCategory -> String
swapCategoryToString value =
    case value of
        SwapCategoryBracket ->
            "bracket"

        SwapCategorySynergy ->
            "synergy"

        SwapCategoryCombo ->
            "combo"

        SwapCategoryMana ->
            "mana"

        SwapCategoryRamp ->
            "ramp"

        SwapCategoryDraw ->
            "draw"

        SwapCategoryInteraction ->
            "interaction"

        SwapCategoryCurve ->
            "curve"

        SwapCategoryOther ->
            "other"


swapCategoryFromString : String -> Maybe SwapCategory
swapCategoryFromString value =
    case value of
        "bracket" ->
            Just SwapCategoryBracket

        "synergy" ->
            Just SwapCategorySynergy

        "combo" ->
            Just SwapCategoryCombo

        "mana" ->
            Just SwapCategoryMana

        "ramp" ->
            Just SwapCategoryRamp

        "draw" ->
            Just SwapCategoryDraw

        "interaction" ->
            Just SwapCategoryInteraction

        "curve" ->
            Just SwapCategoryCurve

        "other" ->
            Just SwapCategoryOther

        _ ->
            Nothing


swapCategoryDecoder : Decoder SwapCategory
swapCategoryDecoder =
    D.string
        |> D.andThen
            (\value ->
                case swapCategoryFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown SwapCategory: " ++ value)
            )


encodeSwapCategory : SwapCategory -> E.Value
encodeSwapCategory =
    swapCategoryToString >> E.string


type alias Synergy =
    { title : String
    , cards : List String
    , explanation : String
    }


synergyDecoder : Decoder Synergy
synergyDecoder =
    D.succeed Synergy
        |> P.required "title" D.string
        |> P.required "cards" (D.list D.string)
        |> P.required "explanation" D.string


encodeSynergy : Synergy -> E.Value
encodeSynergy value =
    E.object
        (List.filterMap identity
            [ Just ( "title", E.string value.title )
            , Just ( "cards", E.list E.string value.cards )
            , Just ( "explanation", E.string value.explanation )
            ]
        )


type Tone
    = ToneMax
    | ToneBalanced
    | ToneCasual


toneToString : Tone -> String
toneToString value =
    case value of
        ToneMax ->
            "max"

        ToneBalanced ->
            "balanced"

        ToneCasual ->
            "casual"


toneFromString : String -> Maybe Tone
toneFromString value =
    case value of
        "max" ->
            Just ToneMax

        "balanced" ->
            Just ToneBalanced

        "casual" ->
            Just ToneCasual

        _ ->
            Nothing


toneDecoder : Decoder Tone
toneDecoder =
    D.string
        |> D.andThen
            (\value ->
                case toneFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown Tone: " ++ value)
            )


encodeTone : Tone -> E.Value
encodeTone =
    toneToString >> E.string


type alias Trace =
    { elapsed : Float
    , tasks : List TraceTask
    , requests : List TraceRequest
    }


traceDecoder : Decoder Trace
traceDecoder =
    D.succeed Trace
        |> P.required "elapsed" D.float
        |> P.required "tasks" (D.list traceTaskDecoder)
        |> P.required "requests" (D.list traceRequestDecoder)


encodeTrace : Trace -> E.Value
encodeTrace value =
    E.object
        (List.filterMap identity
            [ Just ( "elapsed", E.float value.elapsed )
            , Just ( "tasks", E.list encodeTraceTask value.tasks )
            , Just ( "requests", E.list encodeTraceRequest value.requests )
            ]
        )


{-| what: What it asked, briefly: "look up 75 cards".
-}
type alias TraceRequest =
    { service : Service
    , what : String
    , task : Maybe String
    , start : Float
    , end : Maybe Float
    , ok : Maybe Bool
    }


traceRequestDecoder : Decoder TraceRequest
traceRequestDecoder =
    D.succeed TraceRequest
        |> P.required "service" serviceDecoder
        |> P.required "what" D.string
        |> P.optional "task" (D.map Just D.string) Nothing
        |> P.required "start" D.float
        |> P.optional "end" (D.map Just D.float) Nothing
        |> P.optional "ok" (D.map Just D.bool) Nothing


encodeTraceRequest : TraceRequest -> E.Value
encodeTraceRequest value =
    E.object
        (List.filterMap identity
            [ Just ( "service", encodeService value.service )
            , Just ( "what", E.string value.what )
            , Maybe.map (\v -> ( "task", E.string v )) value.task
            , Just ( "start", E.float value.start )
            , Maybe.map (\v -> ( "end", E.float v )) value.end
            , Maybe.map (\v -> ( "ok", E.bool v )) value.ok
            ]
        )


{-| label: What it is, in a few words: "Web research".

doing: What it's doing while it runs: "searching the web for how people build Nekusar".

needs: The tasks it waits for.

-}
type alias TraceTask =
    { name : String
    , label : String
    , doing : String
    , needs : List String
    , state : TraceTaskState
    , start : Maybe Float
    , end : Maybe Float
    }


traceTaskDecoder : Decoder TraceTask
traceTaskDecoder =
    D.succeed TraceTask
        |> P.required "name" D.string
        |> P.required "label" D.string
        |> P.required "doing" D.string
        |> P.required "needs" (D.list D.string)
        |> P.required "state" traceTaskStateDecoder
        |> P.optional "start" (D.map Just D.float) Nothing
        |> P.optional "end" (D.map Just D.float) Nothing


encodeTraceTask : TraceTask -> E.Value
encodeTraceTask value =
    E.object
        (List.filterMap identity
            [ Just ( "name", E.string value.name )
            , Just ( "label", E.string value.label )
            , Just ( "doing", E.string value.doing )
            , Just ( "needs", E.list E.string value.needs )
            , Just ( "state", encodeTraceTaskState value.state )
            , Maybe.map (\v -> ( "start", E.float v )) value.start
            , Maybe.map (\v -> ( "end", E.float v )) value.end
            ]
        )


type TraceTaskState
    = TraceTaskStateWaiting
    | TraceTaskStateRunning
    | TraceTaskStateDone
    | TraceTaskStateFailed


traceTaskStateToString : TraceTaskState -> String
traceTaskStateToString value =
    case value of
        TraceTaskStateWaiting ->
            "waiting"

        TraceTaskStateRunning ->
            "running"

        TraceTaskStateDone ->
            "done"

        TraceTaskStateFailed ->
            "failed"


traceTaskStateFromString : String -> Maybe TraceTaskState
traceTaskStateFromString value =
    case value of
        "waiting" ->
            Just TraceTaskStateWaiting

        "running" ->
            Just TraceTaskStateRunning

        "done" ->
            Just TraceTaskStateDone

        "failed" ->
            Just TraceTaskStateFailed

        _ ->
            Nothing


traceTaskStateDecoder : Decoder TraceTaskState
traceTaskStateDecoder =
    D.string
        |> D.andThen
            (\value ->
                case traceTaskStateFromString value of
                    Just v ->
                        D.succeed v

                    Nothing ->
                        D.fail ("Unknown TraceTaskState: " ++ value)
            )


encodeTraceTaskState : TraceTaskState -> E.Value
encodeTraceTaskState =
    traceTaskStateToString >> E.string
