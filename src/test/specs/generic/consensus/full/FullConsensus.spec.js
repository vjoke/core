describe('FullConsensus', () => {
    const copyChain = async (bcFrom, bcTo) => {
        for (let i = 2; i <= bcFrom.height; i++) {
            const block = await bcFrom.getBlockAt(i, true);
            const status = await bcTo.pushBlock(block);
            expect(status).toBe(FullChain.OK_EXTENDED);
        }
    };

    beforeEach(() => {
        MockClock.install();
        MockClock.speed = 10;

        MockNetwork.install(20); // 20ms delay
    });

    afterEach(() => {
        MockClock.uninstall();
        MockNetwork.uninstall();
    });

    it('can sync a blockchain', (done) => {
        (async () => {
            const blockchain = await TestBlockchain.createVolatileTest(10, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain, consensus1.blockchain);
            expect(consensus1.blockchain.head.equals(blockchain.head)).toBe(true);
            expect(consensus1.blockchain.height).toBe(11);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new WsNetworkConfig('node2.test', 8080, 'key2', 'cert2');
            const consensus2 = await Consensus.volatileFull(netConfig2);
            expect(consensus2.blockchain.head.equals(GenesisConfig.GENESIS_BLOCK)).toBe(true);
            consensus2.network.connect();

            await new Promise(resolve => consensus2.on('established', resolve));
            expect(consensus2.blockchain.head.equals(blockchain.head)).toBe(true);
            expect(consensus2.blockchain.height).toBe(11);
        })().then(done, done.fail);
    });

    it('will adopt the harder chain (2 nodes)', (done) => {
        (async () => {
            // Peer 1
            const blockchain1 = await TestBlockchain.createVolatileTest(8, 2);
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain1, consensus1.blockchain);
            expect(consensus1.blockchain.head.equals(blockchain1.head)).toBe(true);
            expect(consensus1.blockchain.height).toBe(9);
            consensus1.network.connect();

            // Peer 2
            const blockchain2 = await TestBlockchain.createVolatileTest(10, 10);
            const netConfig2 = new WsNetworkConfig('node2.test', 8080, 'key2', 'cert2');
            const consensus2 = await Consensus.volatileFull(netConfig2);
            await copyChain(blockchain2, consensus2.blockchain);
            expect(consensus2.blockchain.head.equals(blockchain2.head)).toBe(true);
            expect(consensus2.blockchain.height).toBe(11);
            consensus2.network.connect();

            await new Promise(resolve => consensus1.on('established', resolve));
            expect(consensus1.blockchain.head.equals(blockchain2.head)).toBe(true);
            expect(consensus1.blockchain.height).toBe(11);
            expect(consensus2.blockchain.head.equals(blockchain2.head)).toBe(true);
            expect(consensus2.blockchain.height).toBe(11);
        })().then(done, done.fail);
    });

    it('will adopt the hardest chain (3 nodes)', (done) => {
        (async () => {
            // Peer 1
            const blockchain1 = await TestBlockchain.createVolatileTest(8, 2);
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain1, consensus1.blockchain);
            expect(consensus1.blockchain.head.equals(blockchain1.head)).toBe(true);
            expect(consensus1.blockchain.height).toBe(9);
            consensus1.network.connect();

            // Peer 2
            const blockchain2 = await TestBlockchain.createVolatileTest(10, 10);
            const netConfig2 = new WsNetworkConfig('node2.test', 8080, 'key2', 'cert2');
            const consensus2 = await Consensus.volatileFull(netConfig2);
            consensus2.network.allowInboundConnections = true;
            await copyChain(blockchain2, consensus2.blockchain);
            expect(consensus2.blockchain.head.equals(blockchain2.head)).toBe(true);
            expect(consensus2.blockchain.height).toBe(11);

            // Peer 3
            const blockchain3 = await TestBlockchain.createVolatileTest(15, 5);
            const netConfig3 = new WsNetworkConfig('node3.test', 8080, 'key3', 'cert3');
            const consensus3 = await Consensus.volatileFull(netConfig3);
            consensus3.network.allowInboundConnections = true;
            await copyChain(blockchain3, consensus3.blockchain);
            expect(consensus3.blockchain.head.equals(blockchain3.head)).toBe(true);
            expect(consensus3.blockchain.height).toBe(16);

            consensus2.network.connect();
            consensus3.network.connect();

            await Promise.all([
                new Promise(resolve => consensus2.on('established', resolve)),
                new Promise(resolve => consensus3.on('established', resolve))
            ]);

            setTimeout(() => {
                expect(consensus1.blockchain.head.equals(blockchain3.head)).toBe(true);
                expect(consensus1.blockchain.height).toBe(16);
                expect(consensus2.blockchain.head.equals(blockchain3.head)).toBe(true);
                expect(consensus2.blockchain.height).toBe(16);
                expect(consensus3.blockchain.head.equals(blockchain3.head)).toBe(true);
                expect(consensus3.blockchain.height).toBe(16);

                done();
            }, 10000);
        })().catch(done.fail);
    });

    it('will adopt the hardest chain (3 nodes, dumb)', (done) => {
        (async () => {
            // Peer 1
            const blockchain1 = await TestBlockchain.createVolatileTest(8, 2);
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain1, consensus1.blockchain);
            expect(consensus1.blockchain.head.equals(blockchain1.head)).toBe(true);
            expect(consensus1.blockchain.height).toBe(9);
            consensus1.network.connect();

            // Peer 2
            const blockchain2 = await TestBlockchain.createVolatileTest(10, 10);
            const netConfig2 = new DumbNetworkConfig();
            const consensus2 = await Consensus.volatileFull(netConfig2);
            await copyChain(blockchain2, consensus2.blockchain);
            expect(consensus2.blockchain.head.equals(blockchain2.head)).toBe(true);
            expect(consensus2.blockchain.height).toBe(11);
            consensus2.network.connect();
            await new Promise(resolve => consensus2.on('established', resolve));

            // Wait for subscribe messages to go through.
            MockClock.tick(4000);

            // Peer 3
            const blockchain3 = await TestBlockchain.createVolatileTest(15, 5);
            const netConfig3 = new DumbNetworkConfig();
            const consensus3 = await Consensus.volatileFull(netConfig3);
            await copyChain(blockchain3, consensus3.blockchain);
            expect(consensus3.blockchain.head.equals(blockchain3.head)).toBe(true);
            expect(consensus3.blockchain.height).toBe(16);
            consensus3.network.connect();

            setTimeout(() => {
                expect(consensus1.blockchain.head.equals(blockchain3.head)).toBe(true);
                expect(consensus1.blockchain.height).toBe(16);
                expect(consensus2.blockchain.head.equals(blockchain3.head)).toBe(true);
                expect(consensus2.blockchain.height).toBe(16);
                expect(consensus3.blockchain.head.equals(blockchain3.head)).toBe(true);
                expect(consensus3.blockchain.height).toBe(16);

                done();
            }, 10000);
        })().catch(done.fail);
    });

    it('stays up to date', (done) => {
        (async () => {
            const blockchain = await TestBlockchain.createVolatileTest(3, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new WsNetworkConfig('node2.test', 8080, 'key2', 'cert2');
            const consensus2 = await Consensus.volatileFull(netConfig2);
            consensus2.network.connect();

            await new Promise(resolve => consensus2.on('established', resolve));

            // Wait for subscribe messages to go through.
            MockClock.tick(4000);

            await copyChain(blockchain, consensus1.blockchain);

            setTimeout(() => {
                expect(consensus1.blockchain.head.equals(blockchain.head)).toBe(true);
                expect(consensus1.blockchain.height).toBe(4);
                expect(consensus2.blockchain.head.equals(blockchain.head)).toBe(true);
                expect(consensus2.blockchain.height).toBe(4);

                done();
            }, 10000);
        })().catch(done.fail);
    });

    it('relays transactions', (done) => {
        (async () => {
            const [user1, user2] = TestBlockchain.getUsers(2);
            const transaction = TestBlockchain.createTransaction(user1.publicKey, user2.address, 1000, 1, 1, user1.privateKey);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new WsNetworkConfig('node2.test', 8080, 'key2', 'cert2');
            const consensus2 = await Consensus.volatileFull(netConfig2);
            consensus2.network.connect();

            await new Promise(resolve => consensus2.on('established', resolve));

            // Wait for subscribe messages to go through.
            MockClock.tick(4000);

            expect(consensus1.mempool.length).toBe(0);
            expect(consensus2.mempool.length).toBe(0);

            const status = await consensus1.mempool.pushTransaction(transaction);
            expect(status).toBe(Mempool.ReturnCode.ACCEPTED);

            expect(consensus1.mempool.length).toBe(1);
            expect(consensus2.mempool.length).toBe(0);

            consensus2.mempool.on('transaction-added', tx => {
                expect(tx.equals(transaction)).toBe(true);
                done();
            });
        })().catch(done.fail);
    });
});
