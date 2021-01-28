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
     */
    getFresh(prefix: string): string {
        if (!(prefix in this.counters)) {
            this.counters[prefix] = 0;
        }

        let res: string;

        do {
            res = prefix + this.counters[prefix]++;
        } while (this.existingNames.has(res));

        return res;
    }
}
