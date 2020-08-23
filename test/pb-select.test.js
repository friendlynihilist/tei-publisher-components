import { fixture, expect, waitUntil } from '@open-wc/testing';
import '../src/pb-select.js';
import '../src/pb-page.js';
import '@polymer/paper-item';


function serializeForm(form) {
    return new URLSearchParams(new FormData(form)).toString();
}

describe('simple select', () => {
    it('submits in form', async () => {
        let initDone;
        document.addEventListener('pb-page-ready', () => {
            initDone = true;
        });
        const el = (
            await fixture(`
                <pb-page endpoint=".">
                    <form action="">
                        <pb-select label="Dinosaurs" name="key" value="1">
                            <paper-item></paper-item>
                            <paper-item value="0">Item 0</paper-item>
                            <paper-item value="1">Item 1</paper-item>
                            <paper-item value="2">Item 2</paper-item>
                            <paper-item value="3">Item 3</paper-item>
                        </pb-select>
                    </form>
                </pb-page>
            `)
        );
        await waitUntil(() => initDone);
        
        const form = el.querySelector('form');
        const select = el.querySelector('pb-select');

        expect(serializeForm(form)).to.equal('key=1');
        expect(select.value).to.equal('1');

        select.value = "2";
        await select.updateComplete;
        expect(serializeForm(form)).to.equal('key=2');
    });
    it('supports multiple selection', async () => {
        let initDone;
        document.addEventListener('pb-page-ready', () => {
            initDone = true;
        });
        const el = (
            await fixture(`
                <pb-page endpoint=".">
                    <form action="">
                        <pb-select label="Items" name="key" values='["1"]' multi>
                            <paper-item></paper-item>
                            <paper-item value="0">Item 0</paper-item>
                            <paper-item value="1">Item 1</paper-item>
                            <paper-item value="2">Item 2</paper-item>
                            <paper-item value="3">Item 3</paper-item>
                        </pb-select>
                    </form>
                </pb-page>
            `)
        );
        await waitUntil(() => initDone);

        const form = el.querySelector('form');
        const select = el.querySelector('pb-select');
        expect(serializeForm(form)).to.equal('key=1');
        expect(select.values).to.deep.equal(['1']);

        select.values = ["2", "3"];
        await select.updateComplete;
        expect(select.values).to.deep.equal(['2', '3']);
        expect(serializeForm(form)).to.equal('key=2&key=3');
    });
});

describe('select initialized from remote data source', () => {
    it('submits in form', async () => {
        let initDone;
        document.addEventListener('pb-page-ready', () => {
            initDone = true;
        });
        const el = (
            await fixture(`
                <pb-page endpoint=".">
                    <form action="">
                        <pb-select label="Language" name="lang" value="de" source="demo/select.json"></pb-select>
                    </form>
                </pb-page>
            `)
        );
        await waitUntil(() => initDone);

        const select = el.querySelector('pb-select');
        await waitUntil(() => select._items.length > 0);
        
        const form = el.querySelector('form');
        expect(serializeForm(form)).to.equal('lang=de');

        select.value = "en";
        await select.updateComplete;
        expect(serializeForm(form)).to.equal('lang=en');
    });
});