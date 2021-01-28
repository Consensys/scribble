export class NameGenerator {
    private counters: { [base: string]: number };
    private existingNames: Set<string>;

    constructor(existingNames: Set<string>) {
        this.counters = {};
        this.existingNames = existingNames;
    }

    /**
     * Get a fresh name `${prefix}[0-9]+`. The returned name
     * will not collide with any of the names in `this.existingNames` or any
     * previous names returned by this function/
     *
     * @param prefix
     * @param skipIdxOnFirst - if true, given a prefix `foo` it generates the sequence [`foo`, `foo1`, ...] instead of [`foo0`, `foo1`, ...]
     */
    getFresh(prefix: string, skipIdxOnFirst = false): string {
        if (!(prefix in this.counters)) {
            if (skipIdxOnFirst) {
                this.counters[prefix] = 1;

                if (!this.existingNames.has(prefix)) {
                    return prefix;
                }
            } else {
                this.counters[prefix] = 0;
            }
        }

        let res: string;

        do {
            res = prefix + this.counters[prefix]++;
        } while (this.existingNames.has(res));

        return res;
    }
}
