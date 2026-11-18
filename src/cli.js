#!/usr/bin/env node

import { createRequire } from "node:module";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runDoctor } from "./doctor.js";
import { runGenerateMarkdown } from "./generate-markdown.js";
import { runGenerateToc } from "./generate-toc.js";
import { runMigrate } from "./migrate.js";

const { version } = createRequire(import.meta.url)("../package.json");

const handle = (run) => async (argv) => {
    try {
        await run(argv);
    } catch (error) {
        console.error(`error: ${error.message}`);
        process.exitCode = 1;
    }
};

const epubPositional = (yargs) =>
    yargs.positional("epub", {
        describe: "Path to the EPUB file",
        type: "string",
        demandOption: true,
    });

const llmOptions = (yargs) =>
    yargs
        .option("model", {
            describe: "LLM model id (default: model_id in epub-to-markdown.yaml)",
            type: "string",
        })
        .option("endpoint", {
            describe: "OpenAI-compatible chat completions endpoint",
            type: "string",
        })
        .option("api-key", {
            describe: "API key (defaults to EPUB_TO_MD_API_KEY or OPENAI_API_KEY)",
            type: "string",
        })
        .option("session", {
            describe: "Value of the X-OpenCode-Session header",
            type: "string",
        })
        .option("retry-delays", {
            describe: "Comma-separated retry delays in seconds (default: 10,30,60)",
            type: "string",
        })
        .option("max-output-tokens", {
            describe: "Override the computed output token budget",
            type: "number",
        })
        .option("reasoning", {
            describe: "Reasoning effort: provider-default, none, minimal, low, medium, high or xhigh",
            type: "string",
        });

const cli = yargs(hideBin(process.argv))
    .scriptName("")
    .usage("<command>")
    .command(
        "generate-toc <epub>",
        "Generate a toc.yaml file with the table of contents of an EPUB file",
        (yargs) =>
            epubPositional(
                llmOptions(yargs)
                    .option("config", {
                        describe: "Path to the configuration file",
                        type: "string",
                        default: "epub-to-markdown.yaml",
                    })
                    .option("llm", {
                        describe: "Review the table of contents with an LLM",
                        type: "boolean",
                        default: false,
                    }),
            ),
        handle((argv) =>
            runGenerateToc({
                epubPath: argv.epub,
                llm: argv.llm,
                cli: { ...argv, reasoning: argv.reasoning === false ? "none" : argv.reasoning },
            }),
        ),
    )
    .command(
        "generate-markdown <epub>",
        "Split the EPUB content into Markdown files following config.yaml",
        epubPositional,
        handle((argv) => runGenerateMarkdown({ epubPath: argv.epub })),
    )
    .command(
        "migrate <book>",
        "Upgrade a book Markdown corpus to the latest schema",
        (yargs) =>
            yargs
                .positional("book", {
                    describe: "Path to the book directory or its EPUB file",
                    type: "string",
                    demandOption: true,
                })
                .option("dry-run", {
                    describe: "Report the changes without writing them",
                    type: "boolean",
                    default: false,
                }),
        handle((argv) => runMigrate({ bookDir: argv.book, dryRun: argv.dryRun })),
    )
    .command(
        "doctor",
        "Check the runtime and the LLM access",
        (yargs) =>
            llmOptions(
                yargs
                    .option("config", {
                        describe: "Path to the YAML configuration file",
                        type: "string",
                        default: "epub-to-markdown.yaml",
                    })
                    .option("llm", {
                        describe: "Run a minimal LLM request to test the API access",
                        type: "boolean",
                        default: true,
                    })
                    .option("timeout", {
                        describe: "Timeout in seconds for the LLM request (default: 30)",
                        type: "number",
                        default: 30,
                    }),
            ),
        handle((argv) =>
            runDoctor({
                configPath: argv.config,
                overrides: {
                    model: argv.model,
                    endpoint: argv.endpoint,
                    apiKey: argv.apiKey,
                    session: argv.session,
                    reasoning: argv.reasoning === false ? "none" : argv.reasoning,
                },
                llm: argv.llm,
                timeoutMs: argv.timeout * 1000,
            }),
        ),
    )
    .command(
        "completion",
        "Generate a shell completion script for bash or zsh",
        () => {},
        () => cli.showCompletionScript("epub-to-markdown", "completion"),
    )
    .demandCommand(1, "Use one of the available commands")
    .strictCommands()
    .recommendCommands()
    .version(version)
    .help();

cli.parse();
