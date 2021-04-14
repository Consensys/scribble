import fse from "fs-extra";
import path from "path";
import { executeTestSuite } from "./vm";

describe("VM", () => {
    const directory = "test/samples/vm/";
    const suites = fse.readdirSync(directory).filter((name) => name.endsWith(".vm.json"));

    for (const suite of suites) {
        const fileName = path.join(directory, suite);
        const config = fse.readJsonSync(fileName);

        executeTestSuite(suite, config);
    }
});
