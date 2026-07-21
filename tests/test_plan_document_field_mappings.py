from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    WORD_SINGLE_NAME_OVERRIDES,
    WORD_SINGLE_SOURCES,
    build_default_word_mappings,
)


PLAN_SUBMISSION_WORD_FIELDS = {
    "so_to_trinh_du_toan": "so_ttr_du_toan",
    "so_to_trinh_ke_hoach": "so_ttr_ke_hoach",
    "so_to_trinh_du_toan_ke_hoach": "so_ttr_du_toan_ke_hoach",
}


def test_plan_submission_numbers_have_default_word_mappings():
    assert WORD_DEFAULT_MAPPINGS_VERSION >= 8

    plan_sources = set(WORD_SINGLE_SOURCES["ke_hoach_lcnt"])
    generated = {
        mapping["source_column"]: mapping
        for mapping in build_default_word_mappings()
        if mapping["source_table"] == "ke_hoach_lcnt"
    }

    for source_column, variable_name in PLAN_SUBMISSION_WORD_FIELDS.items():
        assert source_column in plan_sources
        assert WORD_SINGLE_NAME_OVERRIDES[("ke_hoach_lcnt", source_column)] == variable_name
        assert generated[source_column]["ten_bien"] == variable_name
        assert generated[source_column]["format"] == "text"
