export function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
    const res: Set<T> = new Set();
    a.forEach((el) => {
        if (b.has(el)) res.add(el);
    });
    return res;
}

export function union<T>(a: Set<T>, b: Set<T>): Set<T> {
    const res: Set<T> = new Set();
    a.forEach((el) => res.add(el));
    b.forEach((el) => res.add(el));
    return res;
}
