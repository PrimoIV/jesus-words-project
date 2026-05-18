export const SPEECH_BLOCK_SKIPPED_IDS = [
    { blockId: "good_shepherd", verseId: "JHN_10_6", reason: "Not present in dataset" },
    { blockId: "last_supper_discourse", verseId: "JHN_13_37", reason: "Not present in dataset" },
    { blockId: "last_supper_discourse", verseId: "JHN_14_5", reason: "Not present in dataset" },
    { blockId: "last_supper_discourse", verseId: "JHN_14_8", reason: "Not present in dataset" },
    { blockId: "last_supper_discourse", verseId: "JHN_14_22", reason: "Not present in dataset" },
    { blockId: "last_supper_discourse", verseId: "JHN_16_29", reason: "Not present in dataset" },
    { blockId: "last_supper_discourse", verseId: "JHN_16_30", reason: "Not present in dataset" }
];

export const SPEECH_BLOCKS = [
    {
        id: "sermon_on_the_mount_beatitudes",
        title: "The Beatitudes",
        book: "Matthew",
        startRef: "Matthew 5:3",
        endRef: "Matthew 5:12",
        verseIds: ["MAT_5_3", "MAT_5_4", "MAT_5_5", "MAT_5_6", "MAT_5_7", "MAT_5_8", "MAT_5_9", "MAT_5_10", "MAT_5_11", "MAT_5_12"],
        contextLabel: "Jesus addresses the crowd during the Sermon on the Mount.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_salt_and_light",
        title: "Salt and Light",
        book: "Matthew",
        startRef: "Matthew 5:13",
        endRef: "Matthew 5:16",
        verseIds: ["MAT_5_13", "MAT_5_14", "MAT_5_15", "MAT_5_16"],
        contextLabel: "Jesus teaches the crowd about visible faithfulness.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_fulfillment_law",
        title: "Fulfillment of the Law",
        book: "Matthew",
        startRef: "Matthew 5:17",
        endRef: "Matthew 5:20",
        verseIds: ["MAT_5_17", "MAT_5_18", "MAT_5_19", "MAT_5_20"],
        contextLabel: "Jesus teaches the crowd about the Law and righteousness.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_anger_reconciliation",
        title: "Anger and Reconciliation",
        book: "Matthew",
        startRef: "Matthew 5:21",
        endRef: "Matthew 5:26",
        verseIds: ["MAT_5_21", "MAT_5_22", "MAT_5_23", "MAT_5_24", "MAT_5_25", "MAT_5_26"],
        contextLabel: "Jesus teaches the crowd about anger, judgment, and reconciliation.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_lust_integrity",
        title: "Lust and Integrity",
        book: "Matthew",
        startRef: "Matthew 5:27",
        endRef: "Matthew 5:30",
        verseIds: ["MAT_5_27", "MAT_5_28", "MAT_5_29", "MAT_5_30"],
        contextLabel: "Jesus teaches the crowd about desire and integrity.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_love_enemies",
        title: "Love Your Enemies",
        book: "Matthew",
        startRef: "Matthew 5:43",
        endRef: "Matthew 5:48",
        verseIds: ["MAT_5_43", "MAT_5_44", "MAT_5_45", "MAT_5_46", "MAT_5_47", "MAT_5_48"],
        contextLabel: "Jesus teaches the crowd about enemy-love.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_lords_prayer",
        title: "The Lord's Prayer",
        book: "Matthew",
        startRef: "Matthew 6:9",
        endRef: "Matthew 6:13",
        verseIds: ["MAT_6_9", "MAT_6_10", "MAT_6_11", "MAT_6_12", "MAT_6_13"],
        contextLabel: "Jesus teaches the disciples how to pray.",
        category: "prayer"
    },
    {
        id: "sermon_on_the_mount_do_not_worry",
        title: "Do Not Worry",
        book: "Matthew",
        startRef: "Matthew 6:25",
        endRef: "Matthew 6:34",
        verseIds: ["MAT_6_25", "MAT_6_26", "MAT_6_27", "MAT_6_28", "MAT_6_29", "MAT_6_30", "MAT_6_31", "MAT_6_32", "MAT_6_33", "MAT_6_34"],
        contextLabel: "Jesus teaches the crowd about trust and daily provision.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_judge_not",
        title: "Judge Not",
        book: "Matthew",
        startRef: "Matthew 7:1",
        endRef: "Matthew 7:5",
        verseIds: ["MAT_7_1", "MAT_7_2", "MAT_7_3", "MAT_7_4", "MAT_7_5"],
        contextLabel: "Jesus teaches the crowd about judgment and self-examination.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_ask_seek_knock",
        title: "Ask, Seek, Knock",
        book: "Matthew",
        startRef: "Matthew 7:7",
        endRef: "Matthew 7:11",
        verseIds: ["MAT_7_7", "MAT_7_8", "MAT_7_9", "MAT_7_10", "MAT_7_11"],
        contextLabel: "Jesus teaches the crowd about asking the Father.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_golden_rule",
        title: "Golden Rule",
        book: "Matthew",
        startRef: "Matthew 7:12",
        endRef: "Matthew 7:12",
        verseIds: ["MAT_7_12"],
        contextLabel: "Jesus summarizes the Law and the Prophets for the crowd.",
        category: "teaching"
    },
    {
        id: "sermon_on_the_mount_narrow_gate",
        title: "Narrow Gate",
        book: "Matthew",
        startRef: "Matthew 7:13",
        endRef: "Matthew 7:14",
        verseIds: ["MAT_7_13", "MAT_7_14"],
        contextLabel: "Jesus warns the crowd about the narrow way.",
        category: "warning"
    },
    {
        id: "sermon_on_the_mount_wise_foolish_builders",
        title: "Wise and Foolish Builders",
        book: "Matthew",
        startRef: "Matthew 7:24",
        endRef: "Matthew 7:27",
        verseIds: ["MAT_7_24", "MAT_7_25", "MAT_7_26", "MAT_7_27"],
        contextLabel: "Jesus concludes the Sermon on the Mount with a house-building image.",
        category: "parable"
    },
    {
        id: "parable_sower",
        title: "Parable of the Sower",
        book: "Matthew",
        startRef: "Matthew 13:3",
        endRef: "Matthew 13:9",
        verseIds: ["MAT_13_3", "MAT_13_4", "MAT_13_5", "MAT_13_6", "MAT_13_7", "MAT_13_8", "MAT_13_9"],
        contextLabel: "Jesus tells the crowd a parable about seed and soil.",
        category: "parable"
    },
    {
        id: "parable_lost_sheep",
        title: "Lost Sheep",
        book: "Matthew",
        startRef: "Matthew 18:12",
        endRef: "Matthew 18:14",
        verseIds: ["MAT_18_12", "MAT_18_13", "MAT_18_14"],
        contextLabel: "Jesus teaches the disciples with an image of a lost sheep.",
        category: "parable"
    },
    {
        id: "good_shepherd",
        title: "Good Shepherd",
        book: "John",
        startRef: "John 10:1",
        endRef: "John 10:18",
        verseIds: ["JHN_10_1", "JHN_10_2", "JHN_10_3", "JHN_10_4", "JHN_10_5", "JHN_10_7", "JHN_10_8", "JHN_10_9", "JHN_10_10", "JHN_10_11", "JHN_10_12", "JHN_10_13", "JHN_10_14", "JHN_10_15", "JHN_10_16", "JHN_10_17", "JHN_10_18"],
        contextLabel: "Jesus teaches with the image of the good shepherd.",
        category: "discourse"
    },
    {
        id: "vine_and_branches",
        title: "Vine and Branches",
        book: "John",
        startRef: "John 15:1",
        endRef: "John 15:17",
        verseIds: ["JHN_15_1", "JHN_15_2", "JHN_15_3", "JHN_15_4", "JHN_15_5", "JHN_15_6", "JHN_15_7", "JHN_15_8", "JHN_15_9", "JHN_15_10", "JHN_15_11", "JHN_15_12", "JHN_15_13", "JHN_15_14", "JHN_15_15", "JHN_15_16", "JHN_15_17"],
        contextLabel: "Jesus teaches the disciples with the vine and branches image.",
        category: "discourse"
    },
    {
        id: "last_supper_discourse",
        title: "Last Supper Discourse",
        book: "John",
        startRef: "John 13:31",
        endRef: "John 16:33",
        verseIds: ["JHN_13_31", "JHN_13_32", "JHN_13_33", "JHN_13_34", "JHN_13_35", "JHN_13_36", "JHN_13_38", "JHN_14_1", "JHN_14_2", "JHN_14_3", "JHN_14_4", "JHN_14_6", "JHN_14_7", "JHN_14_9", "JHN_14_10", "JHN_14_11", "JHN_14_12", "JHN_14_13", "JHN_14_14", "JHN_14_15", "JHN_14_16", "JHN_14_17", "JHN_14_18", "JHN_14_19", "JHN_14_20", "JHN_14_21", "JHN_14_23", "JHN_14_24", "JHN_14_25", "JHN_14_26", "JHN_14_27", "JHN_14_28", "JHN_14_29", "JHN_14_30", "JHN_14_31", "JHN_15_1", "JHN_15_2", "JHN_15_3", "JHN_15_4", "JHN_15_5", "JHN_15_6", "JHN_15_7", "JHN_15_8", "JHN_15_9", "JHN_15_10", "JHN_15_11", "JHN_15_12", "JHN_15_13", "JHN_15_14", "JHN_15_15", "JHN_15_16", "JHN_15_17", "JHN_15_18", "JHN_15_19", "JHN_15_20", "JHN_15_21", "JHN_15_22", "JHN_15_23", "JHN_15_24", "JHN_15_25", "JHN_15_26", "JHN_15_27", "JHN_16_1", "JHN_16_2", "JHN_16_3", "JHN_16_4", "JHN_16_5", "JHN_16_6", "JHN_16_7", "JHN_16_8", "JHN_16_9", "JHN_16_10", "JHN_16_11", "JHN_16_12", "JHN_16_13", "JHN_16_14", "JHN_16_15", "JHN_16_16", "JHN_16_17", "JHN_16_18", "JHN_16_19", "JHN_16_20", "JHN_16_21", "JHN_16_22", "JHN_16_23", "JHN_16_24", "JHN_16_25", "JHN_16_26", "JHN_16_27", "JHN_16_28", "JHN_16_31", "JHN_16_32", "JHN_16_33"],
        contextLabel: "Jesus teaches the disciples during the Last Supper discourse.",
        category: "discourse"
    },
    {
        id: "great_commission",
        title: "Great Commission",
        book: "Matthew",
        startRef: "Matthew 28:18",
        endRef: "Matthew 28:20",
        verseIds: ["MAT_28_18", "MAT_28_19", "MAT_28_20"],
        contextLabel: "Jesus commissions the disciples after the resurrection.",
        category: "commission"
    }
];
